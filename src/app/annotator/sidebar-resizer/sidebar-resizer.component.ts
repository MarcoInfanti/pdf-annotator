import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { SidebarWidthService } from '../../services/layout/sidebar-width.service';

/** Draggable and keyboard-operable bar that sets the sidebar width. */
@Component({
  selector: 'app-sidebar-resizer',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar-resizer.component.html',
  styleUrl: './sidebar-resizer.component.scss',
})
export class SidebarResizerComponent {
  protected readonly sidebarWidth = inject(SidebarWidthService);
  protected readonly resizing = signal(false);

  /** Captures the pointer so the drag keeps working outside the thin bar. */
  protected startResize(event: PointerEvent): void {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.resizing.set(true);
  }

  /** The sidebar is on the right, so its width is the distance from the pointer to the edge. */
  protected resize(event: PointerEvent): void {
    if (this.resizing()) this.sidebarWidth.setWidth(window.innerWidth - event.clientX);
  }

  /** Ends the drag started by `startResize`. */
  protected stopResize(event: PointerEvent): void {
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    this.resizing.set(false);
  }

  /** Arrow keys resize by 20px (80px with Shift); Left widens because the sidebar is on the right. */
  protected resizeWithKeys(event: KeyboardEvent): void {
    const step = event.shiftKey ? 80 : 20;
    if (event.key === 'ArrowLeft') this.sidebarWidth.setWidth(this.sidebarWidth.width() + step);
    else if (event.key === 'ArrowRight')
      this.sidebarWidth.setWidth(this.sidebarWidth.width() - step);
    else return;
    event.preventDefault();
  }
}
