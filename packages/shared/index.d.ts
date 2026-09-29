export interface DrawnElement {
  id: string;
  kind: 'stroke' | 'rectangle' | 'ellipse';
  color: string;
  width: number;
  /** World coordinates. Shapes use [startX, startY, endX, endY]. */
  points: number[];
}

export interface ImageElement {
  id: string;
  kind: 'image';
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DrawingElement = DrawnElement | ImageElement;

export interface ImageAsset {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface BoardDocument {
  version: 1;
  elements: DrawingElement[];
}

export interface BoardSummary {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Board extends BoardSummary {
  document: BoardDocument;
}

export interface UpdateBoard {
  title: string;
  document: BoardDocument;
  revision: number;
}
