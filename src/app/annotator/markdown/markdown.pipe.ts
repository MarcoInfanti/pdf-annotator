import type { PipeTransform } from '@angular/core';
import { Pipe } from '@angular/core';
import { marked } from 'marked';

/** Renders Markdown to HTML. Bind the result to [innerHTML] so Angular sanitizes it. */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(value: string): string {
    return marked.parse(value, { async: false, gfm: true, breaks: true });
  }
}
