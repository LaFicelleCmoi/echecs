// Calcul de l'IA hors du fil principal : l'interface reste fluide pendant la réflexion.
import { bestMove } from './ai.js';

self.onmessage = ({ data }) => {
  const move = bestMove(data.fen, data.level, { history: data.history, maxTimeMs: data.maxTimeMs });
  self.postMessage({ id: data.id, move });
};
