import { MarkdownPipe } from './markdown.pipe';

describe('MarkdownPipe', () => {
  const pipe = new MarkdownPipe();

  it('renders bold text as <strong>', () => {
    expect(pipe.transform('**b**')).toContain('<strong>b</strong>');
  });

  it('turns a single newline into <br>', () => {
    expect(pipe.transform('one\ntwo')).toContain('<br>');
  });

  it('renders a GFM table as <table>', () => {
    expect(pipe.transform('| a | b |\n| - | - |\n| 1 | 2 |')).toContain('<table>');
  });

  it('returns an empty string for an empty input', () => {
    expect(pipe.transform('')).toBe('');
  });
});
