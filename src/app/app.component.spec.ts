import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

describe('AppComponent (dev shell)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('creates the standalone dev shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders a skip link as the first focusable element (a11y baseline)', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const skip = el.querySelector('a.skip')!;
    expect(skip.getAttribute('href')).toBe('#main-content');
  });

  it('has a main landmark targeted by the skip link', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const main = el.querySelector('main#main-content')!;
    expect(main.getAttribute('tabindex')).toBe('-1');
  });
});
