// Where a link points (#/name/arg/arg2?query), and which places are worth coming back to after
// signing in: a space from the Library or a draft from a Miracle Plan, not Home, the rules or an
// invite link. Pure: the hash and anything stored come in as arguments.

export function parseHash(hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const [name, arg, arg2] = path.split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : undefined, arg2, q: new URLSearchParams(qs || '') };
}

export const worthReturningTo = (hash) => !!hash && !/^#\/?(?:home|rules|join(?:\/.*)?)?$/.test(hash);
export const validReturn = (hash) => (/^#\/[a-z]/.test(hash) ? hash : '');
