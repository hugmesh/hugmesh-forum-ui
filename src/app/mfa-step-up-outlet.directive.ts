import {
  ComponentRef,
  Directive,
  OnDestroy,
  OnInit,
  Type,
  ViewContainerRef,
  inject,
  input,
  output,
} from '@angular/core';

import { MfaStepUpComponentLike } from './login-remote';

/**
 * Mounts login-ui's federated MFA step-up component (resolved by
 * {@link mfaStepUpRemoteLoader}) in place and re-exposes its three outputs.
 *
 * Why a directive and not `NgComponentOutlet`: the outlet renders a class but
 * offers no way to subscribe to the instance's outputs at the moment it is
 * created, and `satisfied` is the whole point — it is the signal to retry the
 * refused write. A `ViewContainerRef.createComponent` here gives a
 * {@link ComponentRef} whose outputs are wired before the first render.
 *
 * `cancellable` is set FALSE on the embedded dialog: the topic page's own
 * "Not now" (`mod-step-up-dismiss`) stays the single dismiss affordance, so a
 * moderator is not shown two buttons that do the same thing and the existing
 * e2e rows keep one testid to press.
 *
 * Lifetime is owned by the enclosing `@if`: the class is set once per mount and
 * the ref is destroyed with the view.
 */
@Directive({
  selector: '[hugMfaStepUpOutlet]',
  standalone: true,
})
export class MfaStepUpOutletDirective implements OnInit, OnDestroy {
  private readonly vcr = inject(ViewContainerRef);

  /** The component class to mount (login-ui's MfaStepUpComponent). */
  readonly hugMfaStepUpOutlet = input.required<Type<MfaStepUpComponentLike>>();

  /** The session now carries a fresh MFA stamp: retry the identical write. */
  readonly satisfied = output<void>();
  /** The user backed out inside the dialog: do not retry. */
  readonly dismissed = output<void>();
  /** The MFA surface ships dark (503): unmount and fall back. */
  readonly unavailable = output<void>();

  private ref: ComponentRef<MfaStepUpComponentLike> | null = null;

  ngOnInit(): void {
    this.vcr.clear();
    const ref = this.vcr.createComponent(this.hugMfaStepUpOutlet());
    this.ref = ref;
    ref.setInput('cancellable', false);
    ref.instance.satisfied.subscribe(() => this.satisfied.emit());
    ref.instance.dismissed.subscribe(() => this.dismissed.emit());
    ref.instance.unavailable.subscribe(() => this.unavailable.emit());
    ref.changeDetectorRef.markForCheck();
  }

  ngOnDestroy(): void {
    this.ref?.destroy();
    this.ref = null;
    this.vcr.clear();
  }
}
