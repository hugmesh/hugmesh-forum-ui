import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, TitleStrategy } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/auth.interceptor';
import { ForumTitleStrategy } from './app/forum-title.strategy';

bootstrapApplication(AppComponent, {
  // HttpClient powers the forum datastore service (ForumService over the
  // /bff/forum/** BFF paths) and the ng-openapi-gen generated client it now
  // delegates to. The authInterceptor marks each request withCredentials so the
  // HttpOnly bff_ cookie rides to the same-origin BFF (the gateway swaps it into
  // a server-side Bearer; the generated client adds no auth of its own). When
  // federated into the host, the host provides its own HttpClient + interceptor
  // chain; this standalone-dev bootstrap provides one for `ng serve forum`.
  providers: [
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // Per-route tab titles for the standalone dev shell only (the host owns the
    // document title in production; see ForumTitleStrategy).
    { provide: TitleStrategy, useClass: ForumTitleStrategy },
  ],
}).catch((err) => console.error(err));
