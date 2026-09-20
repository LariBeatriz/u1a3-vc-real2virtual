/**
 * arvr.js – Lógica cliente para a interface AR/VR
 *
 * Responsabilidades:
 *  - Conexão Socket.IO com o servidor
 *  - Envio de comandos via painel de controle
 *  - Recepção de eventos e atualização da cena A-Frame
 */

"use strict";

const PERSON_COLORS = [
  "#FF6584",
  "#4CC3D9",
  "#43E97B",
  "#FFD166",
  "#A78BFA",
  "#FF8A65",
  "#64B5F6",
  "#F06292"
];


function getPersonColor(id) {
  return PERSON_COLORS[
    (Number(id) - 1) % PERSON_COLORS.length
  ];
}

/* ── Estado local ── */
const localState = { objects: {}, skyColor: "#87CEEB" };
let socket = null;

/*
 * Pessoas detectadas pelo CV.
 *
 * ID -> informações da pessoa.
 */
const peopleState = new Map();

/*
 * Tempo que aguardamos antes de remover um avatar.
 *
 * Isso evita que a esfera fique piscando caso
 * o Haar Cascade perca o rosto durante 1 frame.
 */
const PERSON_REMOVE_DELAY = 1500;

/* ── Elementos DOM ── */
const statusDot   = document.getElementById("statusDot");
const statusText  = document.getElementById("statusText");
const connInfo    = document.getElementById("connInfo");
const objCountEl  = document.getElementById("objCount");
const objCountBadge = document.getElementById("objCountBadge");
const peopleCountBadge = document.getElementById("peopleCountBadge");
const objectList  = document.getElementById("objectList");
const logPanel    = document.getElementById("logPanel");

/* ── Utilitários ── */
function log(msg, type = "info") {
  const p = document.createElement("p");
  p.className = type;
  p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logPanel.appendChild(p);
  logPanel.scrollTop = logPanel.scrollHeight;
  if (logPanel.children.length > 80) logPanel.removeChild(logPanel.firstChild);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function updateCounts() {
  const n = Object.keys(localState.objects).length;
  objCountEl.textContent = n;
  objCountBadge.textContent = `${n} objeto${n !== 1 ? "s" : ""}`;
}

function updatePeopleCount() {
  const count =
    peopleState.size;

  if (!peopleCountBadge) {
    return;
  }

  peopleCountBadge.textContent =
    `${count} pessoa` +
    `${count !== 1 ? "s" : ""}`;
}

/* ── Cena A-Frame helpers ── */
const SHAPE_MAP = {
  box:          "a-box",
  sphere:       "a-sphere",
  cylinder:     "a-cylinder",
  cone:         "a-cone",
  torus:        "a-torus",
  dodecahedron: "a-dodecahedron",
};

function createAframeEntity(obj) {
  const tag = SHAPE_MAP[obj.type] || "a-box";
  const el = document.createElement(tag);
  el.setAttribute("id", `obj-${obj.id}`);
  el.setAttribute("position", `${obj.position.x} ${obj.position.y} ${obj.position.z}`);
  el.setAttribute("material", { color: obj.color, metalness: 0.2, roughness: 0.7 });
  el.setAttribute("shadow", "cast: true; receive: true");

  // Sombra suave
  if (obj.type === "box")      el.setAttribute("depth", "0.8");
  if (obj.type === "cylinder") el.setAttribute("radius-top", "0.4");
  if (obj.type === "torus")    el.setAttribute("radius-tubular", "0.08");

  if (obj.animation) attachAnimation(el);
  return el;
}

function attachAnimation(el) {
  el.setAttribute("animation", "property: rotation; to: 0 360 0; loop: true; dur: 3000; easing: linear");
}

function removeAnimation(el) {
  el.removeAttribute("animation");
  el.setAttribute("rotation", "0 0 0");
}

function createPersonAvatar(person) {
  /*
   * Entidade principal da pessoa.
   * É ela que recebe a posição X/Y/Z.
   */
  const root =
    document.createElement("a-entity");

  root.setAttribute(
    "id",
    `person-${person.id}`
  );

  root.setAttribute(
    "position",
    `${person.x} ${person.y} ${person.z}`
  );


  /*
   * Cor baseada no ID.
   */
  const color =
    getPersonColor(person.id);


  /* ======================================================
     ESFERA
     ====================================================== */

  const sphere =
    document.createElement("a-sphere");

  sphere.setAttribute(
    "radius",
    "0.65"
  );

  sphere.setAttribute(
    "color",
    color
  );

  sphere.setAttribute(
    "metalness",
    "0.15"
  );

  sphere.setAttribute(
    "roughness",
    "0.65"
  );

  sphere.setAttribute(
    "shadow",
    "cast: true; receive: true"
  );


  /* ======================================================
     FUNDO DO NOME
     ====================================================== */

  const labelBackground =
    document.createElement("a-plane");

  labelBackground.setAttribute(
    "width",
    "2.3"
  );

  labelBackground.setAttribute(
    "height",
    "0.55"
  );

  labelBackground.setAttribute(
    "position",
    "0 1.5 -0.02"
  );

  labelBackground.setAttribute(
    "color",
    "#000000"
  );

  labelBackground.setAttribute(
    "opacity",
    "0.65"
  );

  labelBackground.setAttribute(
    "material",
    "transparent: true; side: double"
  );


  /* ======================================================
     NOME FLUTUANDO
     ====================================================== */

  const label =
    document.createElement("a-text");

  label.setAttribute(
    "id",
    `person-label-${person.id}`
  );

  label.setAttribute(
    "value",
    person.name || `Pessoa ${person.id}`
  );

  label.setAttribute(
    "align",
    "center"
  );

  label.setAttribute(
    "anchor",
    "center"
  );

  label.setAttribute(
    "baseline",
    "center"
  );

  label.setAttribute(
    "color",
    "#FFFFFF"
  );

  /*
   * Quanto maior o width,
   * maior fica o texto.
   */
  label.setAttribute(
    "width",
    "5"
  );

  /*
   * Nome flutuando 1.5 unidades
   * acima do centro da pessoa.
   */
  label.setAttribute(
    "position",
    "0 1.5 0"
  );


  /* ======================================================
     MARCADOR ABAIXO DA ESFERA
     ====================================================== */

  const marker =
    document.createElement("a-cylinder");

  marker.setAttribute(
    "radius",
    "0.08"
  );

  marker.setAttribute(
    "height",
    "0.5"
  );

  marker.setAttribute(
    "position",
    "0 -0.9 0"
  );

  marker.setAttribute(
    "color",
    color
  );


  /* ======================================================
     MONTA O AVATAR
     ====================================================== */

  root.appendChild(sphere);

  /*
   * Primeiro o fundo,
   * depois o texto.
   */
  root.appendChild(labelBackground);
  root.appendChild(label);

  root.appendChild(marker);


  return root;
}

function updatePeople(people) {
  const container =
    document.getElementById(
      "peopleObjects"
    );

  const now = Date.now();

  const receivedIds = new Set();


  /*
   * ======================================================
   * CRIAR OU ATUALIZAR
   * ======================================================
   */

  for (const person of people) {

    const id =
      String(person.id);

    receivedIds.add(id);


    let entity =
      document.getElementById(
        `person-${id}`
      );


    /*
     * Pessoa nova:
     * cria o avatar.
     */
    if (!entity) {

      entity =
        createPersonAvatar(person);

      container.appendChild(entity);

      log(
        `${person.name} entrou na cena.`,
        "info"
      );
    }


    /*
     * Pessoa já existe:
     * NÃO recriamos.
     *
     * Apenas atualizamos a posição.
     */
    entity.setAttribute(
      "position",

      `${person.x} ` +
      `${person.y} ` +
      `${person.z}`
    );


    /*
     * Atualiza nome caso mude.
     */
    const label =
      document.getElementById(
        `person-label-${id}`
      );

    if (label) {
      label.setAttribute(
        "value",
        person.name
      );
    }


    /*
     * Guarda estado local.
     */
    peopleState.set(
      id,
      {
        ...person,

        lastSeen: now
      }
    );
  }


  /*
   * ======================================================
   * REMOVER QUEM SUMIU
   * ======================================================
   *
   * Não removemos imediatamente.
   *
   * O Haar Cascade pode perder um rosto
   * durante um único frame.
   */

  for (
    const [id, state]
    of peopleState.entries()
  ) {

    /*
     * Se recebeu essa pessoa neste frame,
     * não há nada para fazer.
     */
    if (receivedIds.has(id)) {
      continue;
    }


    const missingFor =
      now - state.lastSeen;


    if (
      missingFor >
      PERSON_REMOVE_DELAY
    ) {

      const entity =
        document.getElementById(
          `person-${id}`
        );

      if (entity) {
        entity.remove();
      }

      peopleState.delete(id);

      log(
        `${state.name} saiu da cena.`,
        "warning"
      );
    }
  }


  updatePeopleCount();
}

/* ── Socket.IO ── */
function initSocket() {
  socket = io({ transports: ["websocket"] });

  socket.on("connect", () => {
    statusDot.classList.add("connected");
    statusText.textContent = "Conectado";
    connInfo.textContent = `ID: ${socket.id}`;
    log("Conectado ao servidor WebSocket.");
    socket.emit("join_arvr");
  });

  socket.on("disconnect", () => {
    statusDot.classList.remove("connected");
    statusText.textContent = "Desconectado";
    connInfo.textContent = "Reconectando…";
    log("Desconectado do servidor.", "warning");
  });

  /* ── Eventos de cena ── */

  socket.on("scene_state", (state) => {
    log(`Estado da cena recebido: ${state.objects.length} objetos.`);
    // Limpa cena e reconstrói
    clearLocalScene();
    document.getElementById("sky").setAttribute("color", state.sky_color);
    localState.skyColor = state.sky_color;
    state.objects.forEach(addObjectToScene);
    updateCounts();
  });

  socket.on(
    "vr_people_update",
    ({ people }) => {

      const safePeople =
        Array.isArray(people)
          ? people
          : [];

      /*
      * Mantemos o console para debug.
      */
      console.log(
        "Pessoas recebidas do CV:",
        safePeople
      );


      /*
      * Agora realmente atualizamos
      * a cena A-Frame.
      */
      updatePeople(
        safePeople
      );
    }
  );

  socket.on("object_added", (obj) => {
    addObjectToScene(obj);
    updateCounts();
    log(`Objeto adicionado: #${obj.id} (${obj.type})`);
  });

  socket.on("object_removed", ({ id }) => {
    removeObjectFromScene(id);
    updateCounts();
    log(`Objeto removido: #${id}`);
  });

  socket.on("sky_changed", ({ color }) => {
    document.getElementById("sky").setAttribute("color", color);
    localState.skyColor = color;
    log(`Cor do céu alterada para ${color}`);
  });

  socket.on("scene_cleared", () => {
    clearLocalScene();
    document.getElementById("sky").setAttribute("color", "#87CEEB");
    updateCounts();
    log("Cena limpa.", "warning");
  });

  socket.on("object_moved", (obj) => {
    const el = document.getElementById(`obj-${obj.id}`);
    if (el) {
      el.setAttribute("position", `${obj.position.x} ${obj.position.y} ${obj.position.z}`);
      if (localState.objects[obj.id]) localState.objects[obj.id].position = obj.position;
    }
    log(`Objeto #${obj.id} movido para (${obj.position.x}, ${obj.position.y}, ${obj.position.z})`);
  });

  socket.on("color_changed", ({ id, color }) => {
    const el = document.getElementById(`obj-${id}`);
    if (el) el.setAttribute("material", { color: color, metalness: 0.2, roughness: 0.7 });
    if (localState.objects[id]) localState.objects[id].color = color;
    renderObjectList();
    log(`Cor do objeto #${id} alterada para ${color}`);
  });

  socket.on("animation_toggled", ({ id, animation }) => {
    const el = document.getElementById(`obj-${id}`);
    if (el) animation ? attachAnimation(el) : removeAnimation(el);
    if (localState.objects[id]) localState.objects[id].animation = animation;
    log(`Animação do objeto #${id}: ${animation ? "ativada" : "desativada"}`);
  });
}

/* ── Manipulação da lista de objetos ── */
function addObjectToScene(obj) {
  localState.objects[obj.id] = obj;
  const container = document.getElementById("sceneObjects");
  const existing = document.getElementById(`obj-${obj.id}`);
  if (existing) existing.remove();
  container.appendChild(createAframeEntity(obj));
  renderObjectList();
}

function removeObjectFromScene(id) {
  const el = document.getElementById(`obj-${id}`);
  if (el) el.remove();
  delete localState.objects[id];
  renderObjectList();
}

function clearLocalScene() {
  document.getElementById("sceneObjects").innerHTML = "";
  Object.keys(localState.objects).forEach(k => delete localState.objects[k]);
  renderObjectList();
}

function renderObjectList() {
  const objs = Object.values(localState.objects);
  if (objs.length === 0) {
    objectList.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1rem">Nenhum objeto ainda</div>`;
    return;
  }
  objectList.innerHTML = objs.map(obj => `
    <div class="object-item">
      <div class="object-item-info">
        <span class="color-dot" style="background:${escHtml(obj.color)}"></span>
        <span>#${escHtml(obj.id)} ${escHtml(obj.type)}</span>
      </div>
      <div class="flex gap-1">
        <input type="color" value="${escHtml(obj.color)}" title="Mudar cor"
               style="width:24px;height:24px;border:none;border-radius:4px;cursor:pointer;padding:0"
               onchange="changeColor(${Number(obj.id)}, this.value)">
        <button class="btn btn-outline btn-sm" title="${obj.animation ? 'Parar animação' : 'Animar'}"
                onclick="toggleAnimation(${Number(obj.id)})">${obj.animation ? "⏸" : "▶"}</button>
        <button class="btn btn-danger btn-sm" title="Remover"
                onclick="removeObject(${Number(obj.id)})">✕</button>
      </div>
    </div>
  `).join("");
}

/* ── Funções chamadas pelos botões HTML ── */
function sendCommand(command, payload = {}) {
  if (!socket || !socket.connected) {
    log("Não conectado ao servidor!", "error");
    return;
  }
  socket.emit("arvr_command", { command, payload });
}

function addObject(type) {
  const color = document.getElementById("objColor").value;
  sendCommand("add_object", { type, color });
}

function removeObject(id) {
  sendCommand("remove_object", { id });
}

function changeSky() {
  const color = document.getElementById("skyColor").value;
  sendCommand("change_sky", { color });
}

function setSkyPreset(color) {
  document.getElementById("skyColor").value = color;
  sendCommand("change_sky", { color });
}

function clearScene() {
  if (confirm("Limpar toda a cena?")) sendCommand("clear_scene");
}

function changeColor(id, color) {
  sendCommand("change_color", { id, color });
}

function toggleAnimation(id) {
  sendCommand("toggle_animation", { id });
}

/* ── Inicialização ── */
document.addEventListener("DOMContentLoaded", initSocket);
