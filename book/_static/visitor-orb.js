/* ==========================================================================
   Visitor orb.

   A social-icon-sized globe that records the visit and shows where previous
   readers came from, as dots on a slowly turning sphere. No text, no panel,
   no totals: at this size it is an icon, and the numbers live on the Worker's
   dashboard instead.

   The orb is drawn only on the landing page, where #visitor-orb exists, but
   this script loads site-wide and records the visit on every page. Without
   that, 28 of the site's 29 pages would go uncounted.

   Purpose built rather than using the visitor-globe web component, which
   renders a globe plus heading, description, visitor list and totals inside a
   closed-off shadow root with no ::part() hooks. None of that survives being
   shrunk to 45px, and the component ships 134KB of script and topology for
   country borders that are invisible at this scale.

   Backend: ../../worker (Cloudflare Worker, geolocation from request.cf).
   ========================================================================== */
(function () {
  var ENDPOINT = "https://visitor-globe.naresh-devula.workers.dev";
  var NS = "http://www.w3.org/2000/svg";
  var TILT = 18;      // degrees north, so the northern hemisphere reads
  var PERIOD = 42000; // ms per rotation, slow enough to not pull the eye

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function build(host) {
    var svg = el("svg", {
      viewBox: "-52 -52 104 104",
      width: "100%",
      height: "100%",
      role: "img",
      "aria-label": "Visitors to this site",
    });

    svg.appendChild(el("circle", { r: 48, class: "vo-ocean" }));

    // A graticule reads as "globe" far better than coastlines do at icon size.
    var g = el("g", { class: "vo-grid" });
    [-60, -30, 0, 30, 60].forEach(function (lat) {
      var phi = (lat * Math.PI) / 180, t = (TILT * Math.PI) / 180;
      var ry = Math.abs(48 * Math.cos(phi) * Math.sin(t)) || 0.6;
      g.appendChild(el("ellipse", {
        cx: 0, cy: -48 * Math.sin(phi) * Math.cos(t),
        rx: 48 * Math.cos(phi), ry: ry,
      }));
    });
    svg.appendChild(g);

    var meridians = el("g", { class: "vo-grid vo-meridians" });
    svg.appendChild(meridians);

    // Clip dots to the sphere: a dot at the limb should look like it is
    // turning around the back, not leaking over the rim.
    var defs = el("defs", {});
    var clip = el("clipPath", { id: "vo-clip" });
    clip.appendChild(el("circle", { r: 46.5 }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    var dots = el("g", { class: "vo-dots", "clip-path": "url(#vo-clip)" });
    svg.appendChild(dots);
    svg.appendChild(el("circle", { r: 48, class: "vo-rim" }));

    host.appendChild(svg);
    return { meridians: meridians, dots: dots };
  }

  /* Orthographic projection. Returns null for points on the far side. */
  function project(lat, lng, spin) {
    var p = (lat * Math.PI) / 180;
    var l = ((lng - spin) * Math.PI) / 180;
    var t = (TILT * Math.PI) / 180;
    var cosc = Math.sin(t) * Math.sin(p) + Math.cos(t) * Math.cos(p) * Math.cos(l);
    if (cosc <= 0.02) return null;
    return {
      x: 48 * Math.cos(p) * Math.sin(l),
      y: -48 * (Math.cos(t) * Math.sin(p) - Math.sin(t) * Math.cos(p) * Math.cos(l)),
      z: cosc,
    };
  }

  function start(host) {
    // host is null on every page but the landing page: record, do not draw.
    var parts = host ? build(host) : null;
    var places = [];
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function draw(spin) {
      if (!parts) return;
      // Meridians, redrawn each frame so the sphere reads as turning.
      var m = "";
      for (var lng = 0; lng < 180; lng += 30) {
        var pts = [];
        for (var lat = -90; lat <= 90; lat += 6) {
          var q = project(lat, lng, spin);
          if (q) pts.push(q.x.toFixed(1) + "," + q.y.toFixed(1));
          else if (pts.length) { m += '<polyline points="' + pts.join(" ") + '"/>'; pts = []; }
        }
        if (pts.length) m += '<polyline points="' + pts.join(" ") + '"/>';
      }
      parts.meridians.innerHTML = m;

      var d = "";
      for (var i = 0; i < places.length; i++) {
        var q = project(places[i].lat, places[i].lng, spin);
        if (!q) continue;
        d += '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) +
             '" r="' + (2.6 + Math.min(2.2, places[i].w)).toFixed(1) +
             '" opacity="' + (0.45 + 0.55 * q.z).toFixed(2) + '"/>';
      }
      parts.dots.innerHTML = d;
    }

    var t0 = Date.now();
    function frame() {
      draw(reduced ? 20 : ((Date.now() - t0) / PERIOD) * 360 % 360);
      if (!reduced) requestAnimationFrame(frame);
    }
    if (parts) frame();

    function load(stats) {
      if (!parts || !stats || !stats.locations) return;
      var max = 1;
      stats.locations.forEach(function (l) { if (l.count > max) max = l.count; });
      places = stats.locations
        .filter(function (l) { return l.lat || l.lng; })
        .map(function (l) {
          return { lat: l.lat, lng: l.lng, w: (l.count / max) * 2.2 };
        });

      // With reduced motion there is no animation loop to pick the new dots
      // up, so redraw once here. The animated path repaints anyway.
      if (reduced) draw(20);
    }

    /* Record this visit, then draw whatever the Worker knows. */
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor_id: visitorId(),
        path: (location.pathname || "/").slice(0, 120),
        title: (document.title || "").slice(0, 120),
        timezone: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || "",
        language: navigator.language || "",
      }),
    })
      .then(function (r) { return r.json(); })
      .then(load)
      .catch(function () {
        /* Blocked, offline, or the Worker is down: still show the globe. */
        fetch(ENDPOINT, { headers: { Accept: "application/json" } })
          .then(function (r) { return r.json(); })
          .then(load)
          .catch(function () {});
      });
  }

  function visitorId() {
    try {
      var k = "vo:id", v = localStorage.getItem(k);
      if (!v) {
        v = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return "";
    }
  }

  var started = false;
  function init() {
    if (started) return;   // the file is registered once, but be safe
    started = true;
    start(document.getElementById("visitor-orb"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
