window.APP = {
  template: '#app_template',
  name: 'app',
  data() {
    return {
      // ── Estado original ────────────────────────────────────────────────
      style: CONFIG.style,
      showInput: false,
      showWindow: false,
      shouldHide: true,
      backingSuggestions: [],
      removedSuggestions: [],
      templates: CONFIG.templates,
      message: '',
      messages: [],
      oldMessages: [],
      oldMessagesIndex: -1,
      tplBackups: [],
      msgTplBackups: [],
      pressedKeys: {},
      selectedSuggestionIdx: 0,

      // ── Settings ───────────────────────────────────────────────────────
      showSettings: false,
      settingsData: {
        position:  CONFIG.defaultPosition  || 'left',
        bgColor:   CONFIG.defaultBgColor   || '#134855',
        textColor: CONFIG.defaultTextColor || '#ffffff',
      },

      // ── Color picker state ─────────────────────────────────────────────
      colorPickerState: {
        open:          false,
        target:        null, // 'bg' | 'text'
        hsv:           { h: 192, s: 78, v: 33 }, // corresponde ao #134855 por defeito
        isDraggingSV:  false,
        isDraggingHue: false,
      },
    };
  },

  // ──────────────────────────────────────────────────────────────────────────
  // COMPUTED
  // ──────────────────────────────────────────────────────────────────────────
  computed: {
    emptySuggestions() {
      if (this.message === '') return true;

      const slashMessage = this.message;
      const suggestionList = this.backingSuggestions.filter(
        (el) => this.removedSuggestions.indexOf(el.name) <= -1
      );
      const currentSuggestions = suggestionList.filter((s) => {
        if (!s.name.startsWith(slashMessage)) {
          const suggestionSplitted = s.name.split(' ');
          const messageSplitted    = slashMessage.split(' ');
          for (let i = 0; i < messageSplitted.length; i += 1) {
            if (i >= suggestionSplitted.length) {
              return i < suggestionSplitted.length + s.params.length;
            }
            if (suggestionSplitted[i] !== messageSplitted[i]) return false;
          }
        }
        return true;
      }).slice(0, CONFIG.suggestionLimit);

      return currentSuggestions.length === 0;
    },

    suggestions() {
      return this.backingSuggestions.filter(
        (el) => this.removedSuggestions.indexOf(el.name) <= -1
      );
    },

    // Estilo dinâmico do .chat-window (posição configural)
    computedWindowStyle() {
      const base = { ...this.style };
      if (this.settingsData.position === 'right') {
        return { ...base, left: 'auto', right: '40px' };
      } else if (this.settingsData.position === 'center') {
        return { ...base, left: '50%', transform: 'translateX(-50%)' };
      }
      // 'left' — usa o CSS por defeito (left: 40px)
      return base;
    },

    // Estilo dinâmico do .chat-input (posição configural)
    computedInputStyle() {
      if (this.settingsData.position === 'right') {
        return { left: 'auto', right: '50px' };
      } else if (this.settingsData.position === 'center') {
        return { left: '50%', transform: 'translateX(-50%)' };
      }
      // 'left' — usa o CSS por defeito (left: 50px)
      return {};
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ──────────────────────────────────────────────────────────────────────────
  destroyed() {
    clearInterval(this.focusTimer);
    window.removeEventListener('message', this.listener);
  },

  mounted() {
    post('http://ef-chat/loaded', JSON.stringify({}));
    this.listener = window.addEventListener('message', (event) => {
      const item = event.data || event.detail; // 'detail' é para debug no browser
      if (this[item.type]) {
        this[item.type](item);
      }
    });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // WATCHERS
  // ──────────────────────────────────────────────────────────────────────────
  watch: {
    messages() {
      if (this.showWindowTimer) clearTimeout(this.showWindowTimer);
      this.showWindow = true;
      this.resetShowWindowTimer();

      const messagesObj = this.$refs.messages;
      this.$nextTick(() => {
        messagesObj.scrollTop = messagesObj.scrollHeight;
      });
    },

    message() {
      this.selectedSuggestionIdx = 0;
    },

    // Redesenha os canvas do color picker assim que abre (após v-if renderizar)
    'colorPickerState.open'(val) {
      if (val) {
        this.$nextTick(() => {
          this.drawSVCanvas();
          this.drawHueCanvas();
        });
      }
    },

    // Quando a hue muda (ao arrastar a barra), redesenha o quadrado SV
    'colorPickerState.hsv.h'() {
      if (this.colorPickerState.open) {
        this.$nextTick(() => this.drawSVCanvas());
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // METHODS
  // ──────────────────────────────────────────────────────────────────────────
  methods: {

    // ── Handlers de mensagens NUI ────────────────────────────────────────

    ON_SCREEN_STATE_CHANGE({ shouldHide }) {
      this.shouldHide = shouldHide;
    },

    ON_OPEN() {
      this.showInput  = true;
      this.showWindow = true;
      if (this.showWindowTimer) clearTimeout(this.showWindowTimer);
      this.focusTimer = setInterval(() => {
        if (this.$refs.input) {
          this.$refs.input.focus();
        } else {
          clearInterval(this.focusTimer);
        }
      }, 100);
    },

    ON_MESSAGE({ message }) {
      this.messages.push(message);
    },

    ON_CLEAR() {
      this.messages        = [];
      this.oldMessages     = [];
      this.oldMessagesIndex = -1;
    },

    ON_SUGGESTION_ADD({ suggestion }) {
      const duplicateSuggestion = this.backingSuggestions.find(a => a.name == suggestion.name);
      if (duplicateSuggestion) {
        if (suggestion.help || suggestion.params) {
          duplicateSuggestion.help   = suggestion.help   || '';
          duplicateSuggestion.params = suggestion.params || [];
        }
        return;
      }
      if (!suggestion.params) suggestion.params = [];

      if (this.removedSuggestions.find(a => a.name == suggestion.name)) {
        this.removedSuggestions.splice(this.removedSuggestions.indexOf(suggestion.name), 1);
      }
      this.backingSuggestions.push(suggestion);
    },

    ON_SUGGESTION_REMOVE({ name }) {
      if (this.removedSuggestions.indexOf(name) <= -1) {
        this.removedSuggestions.push(name);
      }
    },

    ON_COMMANDS_RESET() {
      console.log('Resetting Command Suggestions');
      this.removedSuggestions = [];
      this.backingSuggestions = [];
    },

    ON_TEMPLATE_ADD({ template }) {
      if (this.templates[template.id]) {
        this.warn(`Tried to add duplicate template '${template.id}'`);
      } else {
        this.templates[template.id] = template.html;
      }
    },

    ON_UPDATE_THEMES({ themes }) {
      this.removeThemes();
      this.setThemes(themes);
    },

    // ── Settings NUI handlers ────────────────────────────────────────────

    // Recebido via Lua (comando /chatsettings)
    ON_OPEN_SETTINGS() {
      this.showSettings = true;
    },

    // Recebido após carregar o recurso (KVP guardado anteriormente)
    ON_LOAD_SETTINGS({ settings }) {
      if (settings.position)  this.settingsData.position  = settings.position;
      if (settings.bgColor)   this.settingsData.bgColor   = settings.bgColor;
      if (settings.textColor) this.settingsData.textColor = settings.textColor;
      this.applyCSSSettings();
    },

    // ── Settings: abrir / fechar / guardar ──────────────────────────────

    // Chamado pelo botão de engrenagem na NUI (quando NUI já tem foco)
    openSettings() {
      this.showSettings = true;
      // Diz ao Lua para garantir NUI focus (idempotente se já estava ativo)
      post('http://ef-chat/openSettings', JSON.stringify({}));
    },

    closeSettings() {
      this.colorPickerState.open   = false;
      this.colorPickerState.target = null;
      this.showSettings            = false;
      // Liberta o foco do NUI (Lua trata disso)
      post('http://ef-chat/settingsClosed', JSON.stringify({}));
    },

    saveSettings() {
      this.applyCSSSettings();
      post('http://ef-chat/saveSettings', JSON.stringify({
        position:  this.settingsData.position,
        bgColor:   this.settingsData.bgColor,
        textColor: this.settingsData.textColor,
      }));
      this.closeSettings();
    },

    resetSettings() {
      this.settingsData.position  = CONFIG.defaultPosition  || 'left';
      this.settingsData.bgColor   = CONFIG.defaultBgColor   || '#134855';
      this.settingsData.textColor = CONFIG.defaultTextColor || '#ffffff';
      this.colorPickerState.open  = false;
      this.colorPickerState.target = null;
      this.applyCSSSettings();
    },

    setPosition(pos) {
      this.settingsData.position = pos;
    },

    // Aplica as cores às variáveis CSS globais (afeta imediatamente todos os elementos)
    applyCSSSettings() {
      document.documentElement.style.setProperty('--chat-bg1', this.hexToRgbaStr(this.settingsData.bgColor, 0.767));
      document.documentElement.style.setProperty('--chat-bg2', this.hexToRgbaStr(this.settingsData.bgColor, 0.692));
      document.documentElement.style.setProperty('--chat-text', this.settingsData.textColor);
    },

    // ── Color Picker ─────────────────────────────────────────────────────

    toggleColorPicker(target) {
      if (this.colorPickerState.open && this.colorPickerState.target === target) {
        // Fechar se já estava aberto para o mesmo alvo
        this.colorPickerState.open   = false;
        this.colorPickerState.target = null;
      } else {
        // Abrir para o alvo selecionado, sincronizando o HSV com a cor atual
        this.colorPickerState.target = target;
        const hex = target === 'bg' ? this.settingsData.bgColor : this.settingsData.textColor;
        try {
          const [h, s, v] = this.hexToHsv(hex);
          this.colorPickerState.hsv = { h, s, v };
        } catch (e) {
          this.colorPickerState.hsv = { h: 0, s: 0, v: 100 };
        }
        this.colorPickerState.open = true;
      }
    },

    onBgHexInput() {
      if (!this.isValidHex(this.settingsData.bgColor)) return;
      this.applyCSSSettings();
      if (this.colorPickerState.open && this.colorPickerState.target === 'bg') {
        const [h, s, v] = this.hexToHsv(this.settingsData.bgColor);
        this.colorPickerState.hsv = { h, s, v };
        this.$nextTick(() => { this.drawSVCanvas(); this.drawHueCanvas(); });
      }
    },

    onTextHexInput() {
      if (!this.isValidHex(this.settingsData.textColor)) return;
      this.applyCSSSettings();
      if (this.colorPickerState.open && this.colorPickerState.target === 'text') {
        const [h, s, v] = this.hexToHsv(this.settingsData.textColor);
        this.colorPickerState.hsv = { h, s, v };
        this.$nextTick(() => { this.drawSVCanvas(); this.drawHueCanvas(); });
      }
    },

    isValidHex(hex) {
      return /^#[0-9A-Fa-f]{6}$/.test(hex);
    },

    // ── Canvas: desenho ──────────────────────────────────────────────────

    // Quadrado SV (Saturação × Valor) para a hue atual
    drawSVCanvas() {
      const canvas = this.$refs.svCanvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w   = canvas.width;
      const h   = canvas.height;

      // Gradiente horizontal: branco → cor da hue atual
      const [r, g, b] = this.hsvToRgb(this.colorPickerState.hsv.h, 100, 100);
      const gradH = ctx.createLinearGradient(0, 0, w, 0);
      gradH.addColorStop(0, 'white');
      gradH.addColorStop(1, `rgb(${r},${g},${b})`);
      ctx.fillStyle = gradH;
      ctx.fillRect(0, 0, w, h);

      // Gradiente vertical: transparente → preto
      const gradV = ctx.createLinearGradient(0, 0, 0, h);
      gradV.addColorStop(0, 'rgba(0,0,0,0)');
      gradV.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = gradV;
      ctx.fillRect(0, 0, w, h);

      // Cursor (círculo na posição atual)
      const cx = (this.colorPickerState.hsv.s / 100) * w;
      const cy = (1 - this.colorPickerState.hsv.v / 100) * h;
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
      ctx.strokeStyle = 'white';
      ctx.lineWidth   = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth   = 1;
      ctx.stroke();
    },

    // Barra de hue (espectro completo 0–360°)
    drawHueCanvas() {
      const canvas = this.$refs.hueCanvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w   = canvas.width;
      const h   = canvas.height;

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      for (let i = 0; i <= 6; i++) {
        const [r2, g2, b2] = this.hsvToRgb(i * 60, 100, 100);
        grad.addColorStop(i / 6, `rgb(${r2},${g2},${b2})`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Cursor (linha vertical)
      const cx = (this.colorPickerState.hsv.h / 360) * w;
      ctx.beginPath();
      ctx.strokeStyle = 'white';
      ctx.lineWidth   = 2;
      ctx.strokeRect(cx - 4, 1, 8, h - 2);
    },

    // ── Canvas: eventos de drag ──────────────────────────────────────────

    startSVDrag(e) {
      this.colorPickerState.isDraggingSV = true;
      this.pickSVAt(e);
    },
    onSVMove(e) {
      if (this.colorPickerState.isDraggingSV) this.pickSVAt(e);
    },
    startHueDrag(e) {
      this.colorPickerState.isDraggingHue = true;
      this.pickHueAt(e);
    },
    onHueMove(e) {
      if (this.colorPickerState.isDraggingHue) this.pickHueAt(e);
    },
    stopDrag() {
      this.colorPickerState.isDraggingSV  = false;
      this.colorPickerState.isDraggingHue = false;
    },

    pickSVAt(e) {
      const canvas = this.$refs.svCanvas;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x    = Math.max(0, Math.min(canvas.width,  e.clientX - rect.left));
      const y    = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
      this.colorPickerState.hsv.s = (x / canvas.width)  * 100;
      this.colorPickerState.hsv.v = (1 - y / canvas.height) * 100;
      this.updateColorFromHsv();
      this.$nextTick(() => this.drawSVCanvas());
    },

    pickHueAt(e) {
      const canvas = this.$refs.hueCanvas;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x    = Math.max(0, Math.min(canvas.width, e.clientX - rect.left));
      this.colorPickerState.hsv.h = (x / canvas.width) * 360;
      this.updateColorFromHsv();
      this.$nextTick(() => { this.drawSVCanvas(); this.drawHueCanvas(); });
    },

    // Converte HSV atual em hex e aplica ao campo de cor correto em tempo real
    updateColorFromHsv() {
      const hex = this.hsvToHex(
        this.colorPickerState.hsv.h,
        this.colorPickerState.hsv.s,
        this.colorPickerState.hsv.v
      );
      if (this.colorPickerState.target === 'bg') {
        this.settingsData.bgColor = hex;
      } else if (this.colorPickerState.target === 'text') {
        this.settingsData.textColor = hex;
      }
      this.applyCSSSettings();
    },

    // ── Utilitários de cor ───────────────────────────────────────────────

    hsvToRgb(h, s, v) {
      h = h / 360; s = s / 100; v = v / 100;
      let r, g, b;
      const i = Math.floor(h * 6);
      const f = h * 6 - i;
      const p = v * (1 - s);
      const q = v * (1 - f * s);
      const t = v * (1 - (1 - f) * s);
      switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
      }
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    },

    rgbToHex(r, g, b) {
      return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    },

    hexToRgb(hex) {
      hex = hex.replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      return [
        parseInt(hex.substring(0, 2), 16),
        parseInt(hex.substring(2, 4), 16),
        parseInt(hex.substring(4, 6), 16),
      ];
    },

    hexToHsv(hex) {
      let [r, g, b] = this.hexToRgb(hex);
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d   = max - min;
      let h = 0;
      const s = max === 0 ? 0 : d / max;
      const v = max;
      if (max !== min) {
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6;               break;
          case b: h = ((r - g) / d + 4) / 6;               break;
        }
      }
      return [h * 360, s * 100, v * 100];
    },

    hsvToHex(h, s, v) {
      const [r, g, b] = this.hsvToRgb(h, s, v);
      return this.rgbToHex(r, g, b);
    },

    hexToRgbaStr(hex, alpha) {
      try {
        const [r, g, b] = this.hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      } catch (e) {
        return `rgba(19, 72, 85, ${alpha})`;
      }
    },

    // ── Scroll do rato nas sugestões ─────────────────────────────────────

    wheelSuggestion(e) {
      if (e.deltaY > 0) {
        this.switchSuggestionDown();
      } else {
        this.switchSuggestionUp();
      }
    },

    // ── Themes ───────────────────────────────────────────────────────────

    removeThemes() {
      for (let i = 0; i < document.styleSheets.length; i++) {
        const styleSheet = document.styleSheets[i];
        const node       = styleSheet.ownerNode;
        if (node.getAttribute('data-theme')) {
          node.parentNode.removeChild(node);
        }
      }

      this.tplBackups.reverse();
      for (const [elem, oldData] of this.tplBackups) {
        elem.innerText = oldData;
      }
      this.tplBackups = [];

      this.msgTplBackups.reverse();
      for (const [id, oldData] of this.msgTplBackups) {
        this.templates[id] = oldData;
      }
      this.msgTplBackups = [];
    },

    setThemes(themes) {
      for (const [id, data] of Object.entries(themes)) {
        if (data.style) {
          const style = document.createElement('style');
          style.type  = 'text/css';
          style.setAttribute('data-theme', id);
          style.appendChild(document.createTextNode(data.style));
          document.head.appendChild(style);
        }

        if (data.styleSheet) {
          const link  = document.createElement('link');
          link.rel    = 'stylesheet';
          link.type   = 'text/css';
          link.href   = data.baseUrl + data.styleSheet;
          link.setAttribute('data-theme', id);
          document.head.appendChild(link);
        }

        if (data.templates) {
          for (const [tplId, tpl] of Object.entries(data.templates)) {
            const elem = document.getElementById(tplId);
            if (elem) {
              this.tplBackups.push([elem, elem.innerText]);
              elem.innerText = tpl;
            }
          }
        }

        if (data.script) {
          const script = document.createElement('script');
          script.type  = 'text/javascript';
          script.src   = data.baseUrl + data.script;
          document.head.appendChild(script);
        }

        if (data.msgTemplates) {
          for (const [tplId, tpl] of Object.entries(data.msgTemplates)) {
            this.msgTplBackups.push([tplId, this.templates[tplId]]);
            this.templates[tplId] = tpl;
          }
        }
      }
    },

    // ── Utilitários gerais ───────────────────────────────────────────────

    warn(msg) {
      this.messages.push({
        args:     [msg],
        template: '^3<b>CHAT-WARN</b>: ^0{0}',
      });
    },

    clearShowWindowTimer() {
      clearTimeout(this.showWindowTimer);
    },

    resetShowWindowTimer() {
      this.clearShowWindowTimer();
      this.showWindowTimer = setTimeout(() => {
        if (!this.showInput) this.showWindow = false;
      }, CONFIG.fadeTimeout);
    },

    keyUp(e) {
      this.resize();
      delete this.pressedKeys[e.which];
    },

    keyDown(e) {
      this.pressedKeys[e.which] = true;

      if (this.pressedKeys[17] === undefined && (e.which === 38 || e.which === 40)) {
        e.preventDefault();
        this.moveOldMessageIndex(e.which === 38);
      } else if (e.which == 33) {
        var buf = document.getElementsByClassName('chat-messages')[0];
        buf.scrollTop = buf.scrollTop - 100;
      } else if (e.which == 34) {
        var buf = document.getElementsByClassName('chat-messages')[0];
        buf.scrollTop = buf.scrollTop + 100;
      }
    },

    moveOldMessageIndex(up) {
      if (up && this.oldMessages.length > this.oldMessagesIndex + 1) {
        this.oldMessagesIndex += 1;
        this.message = this.oldMessages[this.oldMessagesIndex];
      } else if (!up && this.oldMessagesIndex - 1 >= 0) {
        this.oldMessagesIndex -= 1;
        this.message = this.oldMessages[this.oldMessagesIndex];
      } else if (!up && this.oldMessagesIndex - 1 === -1) {
        this.oldMessagesIndex = -1;
        this.message = '';
      }
    },

    resize() {
      // Reservado para futura funcionalidade de auto-resize do textarea
    },

    send(e) {
      if (this.message !== '') {
        post('http://ef-chat/chatResult', JSON.stringify({
          message: this.message,
        }));
        this.oldMessages.unshift(this.message);
        this.oldMessagesIndex = -1;
        this.hideInput();
      } else {
        this.hideInput(true);
      }
    },

    hideInput(canceled = false) {
      if (canceled) {
        post('http://ef-chat/chatResult', JSON.stringify({ canceled }));
      }
      this.message = '';
      this.showInput = false;
      clearInterval(this.focusTimer);
      this.resetShowWindowTimer();
    },

    // ── Sugestões: completar e navegar ───────────────────────────────────

    completeSuggestion() {
      if (this.message === '') return;
      const slashMessage      = this.message;
      const suggestionList    = this.backingSuggestions.filter(
        (el) => this.removedSuggestions.indexOf(el.name) <= -1
      );
      const currentSuggestions = suggestionList.filter((s) => {
        if (!s.name.startsWith(slashMessage)) {
          const suggestionSplitted = s.name.split(' ');
          const messageSplitted    = slashMessage.split(' ');
          for (let i = 0; i < messageSplitted.length; i += 1) {
            if (i >= suggestionSplitted.length) {
              return i < suggestionSplitted.length + s.params.length;
            }
            if (suggestionSplitted[i] !== messageSplitted[i]) return false;
          }
        }
        return true;
      }).slice(0, CONFIG.suggestionLimit);

      const topSuggestion = currentSuggestions[this.selectedSuggestionIdx];
      if (topSuggestion) this.message = topSuggestion.name;
    },

    switchSuggestionDown() {
      if (this.message === '') return true;
      const slashMessage      = this.message;
      const suggestionList    = this.backingSuggestions.filter(
        (el) => this.removedSuggestions.indexOf(el.name) <= -1
      );
      const currentSuggestions = suggestionList.filter((s) => {
        if (!s.name.startsWith(slashMessage)) {
          const suggestionSplitted = s.name.split(' ');
          const messageSplitted    = slashMessage.split(' ');
          for (let i = 0; i < messageSplitted.length; i += 1) {
            if (i >= suggestionSplitted.length) {
              return i < suggestionSplitted.length + s.params.length;
            }
            if (suggestionSplitted[i] !== messageSplitted[i]) return false;
          }
        }
        return true;
      }).slice(0, CONFIG.suggestionLimit);

      this.selectedSuggestionIdx = (this.selectedSuggestionIdx + 1) % (currentSuggestions.length);
    },

    switchSuggestionUp() {
      if (this.message === '') return true;
      const slashMessage      = this.message;
      const suggestionList    = this.backingSuggestions.filter(
        (el) => this.removedSuggestions.indexOf(el.name) <= -1
      );
      const currentSuggestions = suggestionList.filter((s) => {
        if (!s.name.startsWith(slashMessage)) {
          const suggestionSplitted = s.name.split(' ');
          const messageSplitted    = slashMessage.split(' ');
          for (let i = 0; i < messageSplitted.length; i += 1) {
            if (i >= suggestionSplitted.length) {
              return i < suggestionSplitted.length + s.params.length;
            }
            if (suggestionSplitted[i] !== messageSplitted[i]) return false;
          }
        }
        return true;
      }).slice(0, CONFIG.suggestionLimit);

      let prevSuggestion = this.selectedSuggestionIdx - 1;
      if (prevSuggestion < 0) prevSuggestion = currentSuggestions.length - 1;
      if (prevSuggestion < 0) prevSuggestion = 0;
      this.selectedSuggestionIdx = prevSuggestion;
    },
  },
};
