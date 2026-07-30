import { HttpInterceptorFn } from '@angular/common/http';

/** Marks every outgoing HttpClient request with `withCredentials` so the browser
 *  sends the HttpOnly `bff_` session cookie to the same-origin `/bff/**` paths.
 *  The fe-gateway's BffCookieToBearerWebFilter swaps that cookie into the
 *  `Authorization: Bearer` server-side, so the browser never holds or sends an
 *  admin-capable bearer of its own. This replaces the former localStorage
 *  `bffToken` Bearer the spec-covered forum reads/writes used to carry (directly
 *  here and via the ng-openapi-gen client, which adds no auth of its own).
 *  Requests made while signed out simply carry no cookie and the BFF 401s. */
export const authInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
