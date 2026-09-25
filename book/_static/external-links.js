/* Open external links in a new tab.
   Internal navigation (other pages of this book, in-page anchors) stays in the
   same tab -- spawning a tab for every lecture link would be hostile. */
document.addEventListener("DOMContentLoaded", function () {
  var host = window.location.hostname;
  document.querySelectorAll("a[href]").forEach(function (a) {
    var raw = a.getAttribute("href") || "";
    if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return;   // not navigation
    var url;
    try { url = new URL(a.href, window.location.href); } catch (e) { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    if (url.hostname && url.hostname !== host) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  });
});
