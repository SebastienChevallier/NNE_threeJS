import type { ComponentData, ComponentType, EntityId } from '@nne/core';

/**
 * A component as React sees it: plain data, already copied out of the World.
 * React never holds a reference into the World itself.
 */
export interface ComponentView {
  type: ComponentType;
  data: ComponentData;
}

/** The selected entity, serialized. The only entity shape React ever reads. */
export interface EntityView {
  id: EntityId;
  name: string;
  parent: EntityId | null;
  components: ComponentView[];
}

/** One node of the Hierarchy tree, children already resolved. */
export interface HierarchyNode {
  id: EntityId;
  name: string;
  children: HierarchyNode[];
}

/** An asset as the Assets panel shows it. Mirrors the server's AssetEntry. */
export interface AssetSummary {
  path: string;
  category: string;
  /** URL under /cache, ready to hand to the loader. */
  url: string;
  thumbnailUrl: string | null;
  triangles: number;
}

/** Which viewport owns the canvas. Only one is ever active. */
export type EditorPhase = 'edit' | 'play';
