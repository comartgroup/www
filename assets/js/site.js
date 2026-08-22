/* COMART homepage — header state, mobile menu, scroll reveal */
(function () {
  "use strict";

  var header = document.getElementById("header");
  var burger = document.getElementById("burger");
  var menu = document.getElementById("mobileMenu");

  /* Solid header once the hero starts scrolling away */
  function onScroll() {
    if (window.scrollY > 40) header.classList.add("is-stuck");
    else header.classList.remove("is-stuck");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Mobile menu */
  function closeMenu() {
    burger.classList.remove("is-open");
    menu.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
  }
  burger.addEventListener("click", function () {
    var open = menu.classList.toggle("is-open");
    burger.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) header.classList.add("is-stuck");
  });
  menu.addEventListener("click", function (e) {
    if (e.target.tagName === "A") closeMenu();
  });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 980) closeMenu();
  });

  /* Scroll reveal — staggered inside each group */
  var items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach(function (el) { el.classList.add("is-in"); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;
      var siblings = Array.prototype.slice.call(el.parentNode.children);
      var i = Math.min(siblings.indexOf(el), 5);
      el.style.transitionDelay = (i * 80) + "ms";
      el.classList.add("is-in");
      io.unobserve(el);
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });

  items.forEach(function (el) { io.observe(el); });
})();
