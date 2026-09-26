// Moteur de règles d'échecs complet (sans dépendance).
// Cases indexées de 0 à 63 : index = ligne * 8 + colonne, ligne 0 = rangée 8.
// Pièces : lettres FEN (majuscule = blanc, minuscule = noir).

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

export const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');
export const opposite = (c) => (c === 'w' ? 'b' : 'w');
export const sqName = (sq) => FILES[sq & 7] + (8 - (sq >> 3));
export const sqFromName = (n) => (8 - Number(n[1])) * 8 + FILES.indexOf(n[0]);
export const toUci = (m) => sqName(m.from) + sqName(m.to) + (m.promotion || '');

const inBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

// Coins des tours → droit de roque perdu si la case est touchée.
const ROOK_CORNERS = { 63: 'K', 56: 'Q', 7: 'k', 0: 'q' };

export class Chess {
  constructor(fen = START_FEN) {
    this.load(fen);
  }

  load(fen) {
    const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
    const rows = placement.split('/');
    if (rows.length !== 8) throw new Error(`FEN invalide : ${fen}`);
    this.board = new Array(64).fill(null);
    rows.forEach((row, r) => {
      let c = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) c += Number(ch);
        else this.board[r * 8 + c++] = ch;
      }
    });
    this.turn = turn === 'b' ? 'b' : 'w';
    this.castling = {
      K: castling.includes('K'), Q: castling.includes('Q'),
      k: castling.includes('k'), q: castling.includes('q'),
    };
    this.ep = ep && ep !== '-' ? sqFromName(ep) : -1;
    this.halfmove = Number(half) || 0;
    this.fullmove = Number(full) || 1;
    this.history = [];
    this.positions = new Map();
    this._countPosition(1);
  }

  reset() {
    this.load(START_FEN);
  }

  fen() {
    let out = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = this.board[r * 8 + c];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += p;
      }
      if (empty) out += empty;
      if (r < 7) out += '/';
    }
    const cr = ['K', 'Q', 'k', 'q'].filter((k) => this.castling[k]).join('') || '-';
    const ep = this.ep >= 0 ? sqName(this.ep) : '-';
    return `${out} ${this.turn} ${cr} ${ep} ${this.halfmove} ${this.fullmove}`;
  }

  // Clé de position pour la triple répétition. La case en passant ne compte que
  // si un pion adverse peut réellement la prendre.
  _positionKey() {
    const [placement, turn, castling] = this.fen().split(' ');
    let ep = '-';
    if (this.ep >= 0) {
      const pawn = this.turn === 'w' ? 'P' : 'p';
      const r = (this.ep >> 3) + (this.turn === 'w' ? 1 : -1);
      const c = this.ep & 7;
      if ((c > 0 && this.board[r * 8 + c - 1] === pawn) || (c < 7 && this.board[r * 8 + c + 1] === pawn)) {
        ep = sqName(this.ep);
      }
    }
    return `${placement} ${turn} ${castling} ${ep}`;
  }

  _countPosition(delta) {
    const key = this._positionKey();
    const n = (this.positions.get(key) || 0) + delta;
    if (n > 0) this.positions.set(key, n);
    else this.positions.delete(key);
    return key;
  }

  kingSquare(color) {
    const k = color === 'w' ? 'K' : 'k';
    return this.board.indexOf(k);
  }

  isAttacked(sq, by) {
    const b = this.board;
    const r = sq >> 3, c = sq & 7;
    const up = by === 'w';
    const P = up ? 'P' : 'p', N = up ? 'N' : 'n', B = up ? 'B' : 'b';
    const R = up ? 'R' : 'r', Q = up ? 'Q' : 'q', K = up ? 'K' : 'k';

    // Un pion blanc attaque vers le haut : il se trouve donc une ligne plus bas.
    const pr = r + (up ? 1 : -1);
    if (pr >= 0 && pr < 8) {
      if (c > 0 && b[pr * 8 + c - 1] === P) return true;
      if (c < 7 && b[pr * 8 + c + 1] === P) return true;
    }
    for (const [dr, dc] of KNIGHT) {
      const rr = r + dr, cc = c + dc;
      if (inBoard(rr, cc) && b[rr * 8 + cc] === N) return true;
    }
    for (const [dr, dc] of KING) {
      const rr = r + dr, cc = c + dc;
      if (inBoard(rr, cc) && b[rr * 8 + cc] === K) return true;
    }
    for (const [dirs, a, q] of [[ROOK, R, Q], [BISHOP, B, Q]]) {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inBoard(rr, cc)) {
          const p = b[rr * 8 + cc];
          if (p) {
            if (p === a || p === q) return true;
            break;
          }
          rr += dr; cc += dc;
        }
      }
    }
    return false;
  }

  inCheck(color = this.turn) {
    return this.isAttacked(this.kingSquare(color), opposite(color));
  }

  _pseudoMoves(color) {
    const b = this.board;
    const moves = [];
    const enemy = opposite(color);
    const add = (from, to, flag = 'n', extra = {}) => {
      moves.push({ from, to, piece: b[from], captured: b[to], flag, promotion: null, ...extra });
    };
    const addPawn = (from, to, flag, extra) => {
      const lastRow = color === 'w' ? 0 : 7;
      if (to >> 3 === lastRow) {
        for (const promotion of ['q', 'r', 'b', 'n']) add(from, to, flag, { promotion, ...extra });
      } else {
        add(from, to, flag, extra);
      }
    };

    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p || colorOf(p) !== color) continue;
      const r = sq >> 3, c = sq & 7;
      const type = p.toLowerCase();

      if (type === 'p') {
        const dir = color === 'w' ? -1 : 1;
        const startRow = color === 'w' ? 6 : 1;
        const r1 = r + dir;
        if (r1 < 0 || r1 > 7) continue;
        if (!b[r1 * 8 + c]) {
          addPawn(sq, r1 * 8 + c, 'n');
          const r2 = r + 2 * dir;
          if (r === startRow && !b[r2 * 8 + c]) add(sq, r2 * 8 + c, 'b');
        }
        for (const dc of [-1, 1]) {
          const c1 = c + dc;
          if (c1 < 0 || c1 > 7) continue;
          const to = r1 * 8 + c1;
          if (b[to] && colorOf(b[to]) === enemy) addPawn(sq, to, 'c');
          else if (to === this.ep) add(sq, to, 'e', { captured: color === 'w' ? 'p' : 'P' });
        }
        continue;
      }

      if (type === 'n' || type === 'k') {
        for (const [dr, dc] of type === 'n' ? KNIGHT : KING) {
          const rr = r + dr, cc = c + dc;
          if (!inBoard(rr, cc)) continue;
          const to = rr * 8 + cc;
          if (!b[to]) add(sq, to);
          else if (colorOf(b[to]) === enemy) add(sq, to, 'c');
        }
        if (type === 'k') this._castlingMoves(color, sq, add);
        continue;
      }

      const dirs = type === 'r' ? ROOK : type === 'b' ? BISHOP : KING;
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inBoard(rr, cc)) {
          const to = rr * 8 + cc;
          if (!b[to]) add(sq, to);
          else {
            if (colorOf(b[to]) === enemy) add(sq, to, 'c');
            break;
          }
          rr += dr; cc += dc;
        }
      }
    }
    return moves;
  }

  _castlingMoves(color, sq, add) {
    const b = this.board;
    const home = color === 'w' ? 60 : 4;
    if (sq !== home) return;
    const enemy = opposite(color);
    const [kSide, qSide] = color === 'w' ? ['K', 'Q'] : ['k', 'q'];
    const rook = color === 'w' ? 'R' : 'r';
    if (this.isAttacked(home, enemy)) return;
    if (this.castling[kSide] && b[home + 3] === rook && !b[home + 1] && !b[home + 2] &&
        !this.isAttacked(home + 1, enemy) && !this.isAttacked(home + 2, enemy)) {
      add(home, home + 2, 'k');
    }
    if (this.castling[qSide] && b[home - 4] === rook && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
        !this.isAttacked(home - 1, enemy) && !this.isAttacked(home - 2, enemy)) {
      add(home, home - 2, 'q');
    }
  }

  // Coups légaux : le roi du joueur ne doit pas rester en échec.
  moves({ from } = {}) {
    const color = this.turn;
    const legal = [];
    for (const m of this._pseudoMoves(color)) {
      if (from !== undefined && m.from !== from) continue;
      this.makeMove(m, false);
      if (!this.inCheck(color)) legal.push(m);
      this.undo();
    }
    return legal;
  }

  // Applique un coup (supposé légal). `record` = compter la position pour la
  // répétition ; la recherche de l'IA le désactive pour aller plus vite.
  makeMove(m, record = true) {
    const b = this.board;
    const color = colorOf(m.piece);
    this.history.push({
      move: m,
      castling: { ...this.castling },
      ep: this.ep,
      halfmove: this.halfmove,
      fullmove: this.fullmove,
      recorded: record,
    });

    b[m.to] = m.promotion ? (color === 'w' ? m.promotion.toUpperCase() : m.promotion) : m.piece;
    b[m.from] = null;
    if (m.flag === 'e') b[(m.from & ~7) | (m.to & 7)] = null;
    if (m.flag === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
    if (m.flag === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }

    if (m.piece === 'K') this.castling.K = this.castling.Q = false;
    if (m.piece === 'k') this.castling.k = this.castling.q = false;
    if (ROOK_CORNERS[m.from]) this.castling[ROOK_CORNERS[m.from]] = false;
    if (ROOK_CORNERS[m.to]) this.castling[ROOK_CORNERS[m.to]] = false;

    this.ep = m.flag === 'b' ? (m.from + m.to) >> 1 : -1;
    this.halfmove = m.piece.toLowerCase() === 'p' || m.captured ? 0 : this.halfmove + 1;
    if (color === 'b') this.fullmove++;
    this.turn = opposite(color);
    if (record) this._countPosition(1);
  }

  undo() {
    const entry = this.history.pop();
    if (!entry) return null;
    if (entry.recorded) this._countPosition(-1);
    const { move: m } = entry;
    const b = this.board;
    b[m.from] = m.piece;
    b[m.to] = m.flag === 'e' ? null : m.captured;
    if (m.flag === 'e') b[(m.from & ~7) | (m.to & 7)] = m.captured;
    if (m.flag === 'k') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = null; }
    if (m.flag === 'q') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = null; }
    this.castling = entry.castling;
    this.ep = entry.ep;
    this.halfmove = entry.halfmove;
    this.fullmove = entry.fullmove;
    this.turn = colorOf(m.piece);
    return m;
  }

  // Notation algébrique standard, calculée avant de jouer le coup.
  san(m, legal = this.moves()) {
    let s;
    if (m.flag === 'k') s = 'O-O';
    else if (m.flag === 'q') s = 'O-O-O';
    else {
      const type = m.piece.toLowerCase();
      const capture = Boolean(m.captured);
      if (type === 'p') {
        s = (capture ? sqName(m.from)[0] + 'x' : '') + sqName(m.to);
        if (m.promotion) s += '=' + m.promotion.toUpperCase();
      } else {
        const rivals = legal.filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
        let dis = '';
        if (rivals.length) {
          const sameFile = rivals.some((o) => (o.from & 7) === (m.from & 7));
          const sameRank = rivals.some((o) => o.from >> 3 === m.from >> 3);
          if (!sameFile) dis = sqName(m.from)[0];
          else if (!sameRank) dis = sqName(m.from)[1];
          else dis = sqName(m.from);
        }
        s = type.toUpperCase() + dis + (capture ? 'x' : '') + sqName(m.to);
      }
    }
    this.makeMove(m, false);
    if (this.inCheck()) s += this.moves().length ? '+' : '#';
    this.undo();
    return s;
  }

  // Joue un coup à partir de coordonnées ou d'une chaîne UCI (« e2e4 », « e7e8q »).
  move(from, to, promotion) {
    if (typeof from === 'string' && to === undefined) {
      promotion = from[4];
      to = sqFromName(from.slice(2, 4));
      from = sqFromName(from.slice(0, 2));
    }
    const legal = this.moves();
    const m = legal.find((o) => o.from === from && o.to === to && (!o.promotion || o.promotion === (promotion || 'q')));
    if (!m) return null;
    const san = this.san(m, legal);
    this.makeMove(m, true);
    this.history[this.history.length - 1].san = san;
    return { ...m, san };
  }

  insufficientMaterial() {
    const others = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (p && p.toLowerCase() !== 'k') others.push({ p: p.toLowerCase(), sq });
    }
    if (others.length === 0) return true;
    if (others.length === 1 && (others[0].p === 'n' || others[0].p === 'b')) return true;
    if (others.every((o) => o.p === 'b')) {
      const shade = (sq) => ((sq >> 3) + (sq & 7)) % 2;
      return others.every((o) => shade(o.sq) === shade(others[0].sq));
    }
    return false;
  }

  // État de la partie : null si elle continue.
  outcome() {
    if (this.moves().length === 0) {
      if (this.inCheck()) return { winner: opposite(this.turn), reason: 'checkmate' };
      return { winner: null, reason: 'stalemate' };
    }
    if (this.insufficientMaterial()) return { winner: null, reason: 'insufficient' };
    if (this.halfmove >= 100) return { winner: null, reason: 'fifty' };
    if ((this.positions.get(this._positionKey()) || 0) >= 3) return { winner: null, reason: 'repetition' };
    return null;
  }

  sanHistory() {
    return this.history.map((h) => h.san);
  }

  pgn({ result = '*', white = 'Blancs', black = 'Noirs' } = {}) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const tags = [
      ['Event', 'Partie amicale'], ['Site', typeof location !== 'undefined' ? location.host : '?'],
      ['Date', date], ['White', white], ['Black', black], ['Result', result],
    ].map(([k, v]) => `[${k} "${v}"]`).join('\n');
    const moves = this.sanHistory();
    let body = '';
    moves.forEach((s, i) => {
      if (i % 2 === 0) body += `${i / 2 + 1}. `;
      body += s + ' ';
    });
    return `${tags}\n\n${body}${result}\n`;
  }
}
