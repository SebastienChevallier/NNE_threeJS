import { describe, expect, it } from 'vitest';
import { TEXTURE_LIMITS, categoryOf, validateAssetPath } from '../src/assets/naming.js';

describe('categoryOf', () => {
  it('reads the category from the prefix', () => {
    expect(categoryOf('CHR_Hero.glb')).toBe('CHR');
    expect(categoryOf('PRP_Chair_01.glb')).toBe('PRP');
    expect(categoryOf('ENV_Forest.glb')).toBe('ENV');
    expect(categoryOf('UI_Button.glb')).toBe('UI');
  });

  it('takes the prefix from the file name, not the folder', () => {
    expect(categoryOf('CHR_wrong/PRP_Chair_01.glb')).toBe('PRP');
  });

  it('returns null for an unknown prefix', () => {
    expect(categoryOf('Chair.glb')).toBeNull();
    expect(categoryOf('XXX_Chair.glb')).toBeNull();
  });

  it('is case sensitive: the convention is uppercase', () => {
    expect(categoryOf('chr_Hero.glb')).toBeNull();
  });

  it('requires the underscore, so CHRome is not a character', () => {
    expect(categoryOf('CHRome.glb')).toBeNull();
  });
});

describe('validateAssetPath', () => {
  it('accepts a conforming asset', () => {
    expect(validateAssetPath('props/PRP_Chair_01.glb')).toEqual([]);
  });

  it('rejects a missing category prefix', () => {
    expect(validateAssetPath('props/Chair.glb')).toEqual([
      expect.stringContaining('CHR_'),
    ]);
  });

  it('rejects an extension other than .glb', () => {
    expect(validateAssetPath('props/PRP_Chair_01.fbx')).toEqual([
      expect.stringContaining('.glb'),
    ]);
  });

  it('reports both problems at once', () => {
    expect(validateAssetPath('props/Chair.fbx')).toHaveLength(2);
  });

  it('rejects a name with spaces', () => {
    expect(validateAssetPath('props/PRP_Chair 01.glb')[0]).toMatch(/space/i);
  });

  it('is case insensitive on the extension', () => {
    expect(validateAssetPath('props/PRP_Chair_01.GLB')).toEqual([]);
  });
});

describe('TEXTURE_LIMITS', () => {
  it('caps each category', () => {
    expect(TEXTURE_LIMITS).toEqual({ CHR: 1024, PRP: 512, ENV: 1024, UI: 512 });
  });
});
