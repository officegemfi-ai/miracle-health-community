// A script from elsewhere (analytics, error tracking, the sign-in check), added to the page when
// it's first needed
export function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.setAttribute('src', src);
    s.setAttribute('async', '');
    s.setAttribute('crossorigin', 'anonymous');
    s.onload = ok; s.onerror = fail; document.head.append(s);
  });
}
