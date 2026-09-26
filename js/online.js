// Partie en ligne entre deux navigateurs, en pair-à-pair (WebRTC via PeerJS).
// Pas de serveur de jeu : le serveur public PeerJS sert uniquement à la mise en
// relation, puis les coups transitent directement entre les deux joueurs.
const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PEERJS_SRI = 'sha384-nlUQ8ZqCbvStErob+biJNzSgltf6urV3VGqhfIfzhmg9RXmpeRm76ELw0pYnKlTR';
const ID_PREFIX = 'echecs-lfc-';
const MESSAGE_TYPES = new Set(['start', 'move', 'resign', 'rematch', 'sync']);

const ERRORS = {
  'peer-unavailable': 'Partie introuvable : le lien a expiré ou l’hôte est parti.',
  'unavailable-id': 'Ce code de partie est déjà utilisé.',
  network: 'Connexion au serveur de mise en relation impossible.',
  'server-error': 'Le serveur de mise en relation ne répond pas.',
  'browser-incompatible': 'Ce navigateur ne permet pas le jeu en ligne.',
};

let loading = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PEERJS_URL;
    script.integrity = PEERJS_SRI;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve(window.Peer);
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Impossible de charger le module réseau.'));
    };
    document.head.append(script);
  });
  return loading;
}

export const newCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8);
export const isValidCode = (code) => typeof code === 'string' && /^[a-z0-9]{4,16}$/.test(code);

// Statuts émis : 'connecting', 'waiting' (hôte prêt), 'connected', 'disconnected', 'error'.
export class OnlineSession {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.closed = false;
  }

  get connected() {
    return Boolean(this.conn?.open);
  }

  async host(code = newCode()) {
    this.isHost = true;
    this.code = code;
    await this._open(ID_PREFIX + code);
    this.onStatus('waiting');
    this.peer.on('connection', (conn) => {
      // Un seul adversaire ; il peut toutefois revenir après une coupure.
      if (this.connected) { conn.on('open', () => conn.close()); return; }
      this._bind(conn);
    });
    return code;
  }

  async join(code) {
    if (!isValidCode(code)) throw new Error('Code de partie invalide.');
    this.code = code;
    await this._open();
    this._bind(this.peer.connect(ID_PREFIX + code, { reliable: true }));
  }

  send(message) {
    if (this.connected) this.conn.send(message);
  }

  close() {
    this.closed = true;
    this.conn?.close();
    this.peer?.destroy();
  }

  async _open(id) {
    this.onStatus('connecting');
    const Peer = await loadPeerJS();
    if (this.closed) throw new Error('Session fermée.');
    this.peer = id ? new Peer(id) : new Peer();
    this.peer.on('error', (err) => {
      if (!this.closed) this.onStatus('error', ERRORS[err.type] || err.message);
    });
    this.peer.on('disconnected', () => {
      // Perte du serveur de mise en relation : la connexion directe peut survivre.
      if (!this.closed && !this.peer.destroyed) this.peer.reconnect();
    });
    await new Promise((resolve, reject) => {
      this.peer.once('open', resolve);
      this.peer.once('error', reject);
    });
  }

  _bind(conn) {
    this.conn = conn;
    conn.on('open', () => this.onStatus('connected'));
    conn.on('data', (data) => {
      if (data && typeof data === 'object' && MESSAGE_TYPES.has(data.type)) this.onMessage(data);
    });
    conn.on('close', () => {
      if (this.conn === conn && !this.closed) this.onStatus('disconnected');
    });
  }
}
