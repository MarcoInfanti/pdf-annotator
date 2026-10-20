import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AnnotatorComponent } from './annotator/annotator/annotator.component';

/** Root component: hosts the annotator. */
@Component({
  selector: 'app-root',
  imports: [AnnotatorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-annotator />',
})
export class App {}
