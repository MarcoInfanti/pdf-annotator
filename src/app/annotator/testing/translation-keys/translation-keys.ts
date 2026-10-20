import en from '../../../../assets/i18n/en.json';
import es from '../../../../assets/i18n/es.json';

interface Tree {
  [key: string]: string | Tree;
}

function lookup(bundle: Tree, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<string | Tree | undefined>(
      (node, part) => (typeof node === 'object' ? node[part] : undefined),
      bundle,
    );
  return typeof value === 'string' ? value : undefined;
}

/** Spec helper: the keys among `keys` that are missing from es.json or en.json. */
export function missingTranslationKeys(keys: string[]): string[] {
  return keys.filter((key) => lookup(es, key) === undefined || lookup(en, key) === undefined);
}
