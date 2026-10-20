import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AnnotatorComponent } from './annotator/annotator.component';

@Component({
  selector: 'app-root',
  imports: [AnnotatorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-annotator />',
})
export class App {}
