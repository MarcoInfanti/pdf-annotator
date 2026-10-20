import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { LANGUAGES, LanguageService } from '../../services/layout/language.service';

/** ES | EN segmented control. The choice is stored and applied by `LanguageService`. */
@Component({
  selector: 'app-language-switcher',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './language-switcher.component.html',
  styleUrl: './language-switcher.component.scss',
})
export class LanguageSwitcherComponent {
  protected readonly language = inject(LanguageService);
  protected readonly options = LANGUAGES;
}
