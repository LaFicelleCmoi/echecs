// Calcul de l'IA hors du fil principal : l'interface reste fluide pendant la réflexion.
import { bestMove } from './ai.js';

self.onmessage = ({ data }) => {
  self.postMessage({ id: data.id, move: bestMove(data.fen, data.level) });
};
