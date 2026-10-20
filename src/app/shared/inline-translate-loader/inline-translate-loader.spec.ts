import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';
import { InlineTranslateLoader } from './inline-translate-loader';

interface Tree {
  [key: string]: string | Tree;
}

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((flat, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? { ...flat, [path]: value }
      : { ...flat, ...flatten(value, path) };
  }, {});
}

describe('InlineTranslateLoader', () => {
  const loader = new InlineTranslateLoader();

  function load(lang: string): unknown {
    let result: unknown;
    loader.getTranslation(lang).subscribe((bundle) => (result = bundle));
    return result;
  }

  it('emits the Spanish bundle for es', () => {
    expect(load('es')).toBe(es);
  });

  it('emits the English bundle for en', () => {
    expect(load('en')).toBe(en);
  });

  it('falls back to the Spanish bundle for an unknown language', () => {
    expect(load('xx')).toBe(es);
  });

  it('has the same keys in both bundles', () => {
    expect(Object.keys(flatten(es)).sort()).toEqual(Object.keys(flatten(en)).sort());
  });

  it('has no empty value in either bundle', () => {
    const values = [...Object.values(flatten(es)), ...Object.values(flatten(en))];

    expect(values.every((value) => value.trim() !== '')).toBeTrue();
  });
});
