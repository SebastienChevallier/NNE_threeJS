import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { createGltfTransformOptimizer, readMetadata } from '../src/assets/optimizer.js';

/** A one-triangle document, enough to exercise the real pipeline. */
function triangleDocument(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc.createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]))
    .setBuffer(buffer);
  const indices = doc.createAccessor()
    .setType('SCALAR')
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute('POSITION', position).setIndices(indices);
  const mesh = doc.createMesh('Chair').addPrimitive(primitive);
  const node = doc.createNode('Chair').setMesh(mesh);
  doc.createScene('Scene').addChild(node);
  return doc;
}

describe('readMetadata', () => {
  it('counts triangles', () => {
    expect(readMetadata(triangleDocument()).triangles).toBe(1);
  });

  it('computes the bounding box in metres', () => {
    expect(readMetadata(triangleDocument()).bounds).toEqual({
      min: [0, 0, 0],
      max: [1, 2, 0],
    });
  });

  it('lists animation names', () => {
    const doc = triangleDocument();
    doc.createAnimation('Idle');
    doc.createAnimation('Action_01');
    expect(readMetadata(doc).animations).toEqual(['Action_01', 'Idle']);
  });

  it('returns a zero box for a document with no geometry', () => {
    const doc = new Document();
    doc.createScene('Empty');
    expect(readMetadata(doc).bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
    expect(readMetadata(doc).triangles).toBe(0);
  });

  it('accounts for the node transform in the bounds', () => {
    const doc = triangleDocument();
    doc.getRoot().listNodes()[0]?.setTranslation([10, 0, 0]);
    expect(readMetadata(doc).bounds.max[0]).toBe(11);
  });
});

describe('createGltfTransformOptimizer', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nne-opt-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes an optimized glb and returns its metadata', async () => {
    const source = join(dir, 'PRP_Chair_01.glb');
    const target = join(dir, 'out', 'PRP_Chair_01.glb');
    await new NodeIO().write(source, triangleDocument());

    const optimizer = await createGltfTransformOptimizer();
    const metadata = await optimizer.run({ source, target, category: 'PRP' });

    expect((await stat(target)).size).toBeGreaterThan(0);
    expect(metadata.triangles).toBe(1);
    expect(metadata.bounds.max).toEqual([1, 2, 0]);
  });

  it('creates the target directory when missing', async () => {
    const source = join(dir, 'PRP_Chair_01.glb');
    await new NodeIO().write(source, triangleDocument());
    const target = join(dir, 'deep', 'nested', 'PRP_Chair_01.glb');
    await (await createGltfTransformOptimizer()).run({ source, target, category: 'PRP' });
    expect((await stat(target)).isFile()).toBe(true);
  });

  it('reports a corrupt source as a readable error', async () => {
    const source = join(dir, 'broken.glb');
    await rm(source, { force: true });
    const optimizer = await createGltfTransformOptimizer();
    await expect(optimizer.run({
      source, target: join(dir, 'out.glb'), category: 'PRP',
    })).rejects.toThrow(/broken\.glb/);
  });
});
