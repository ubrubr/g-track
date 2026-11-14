import { LIMITS, number } from './domain.js';

export class NumberWheel extends HTMLElement {
  constructor() { super(); this._value = 0; this.drag = null; this.wheelDelta = 0; }
  connectedCallback() {
    this.kind = this.getAttribute('kind'); this.range = LIMITS[this.kind];
    this._value = Number(this.getAttribute('value') ?? this.range.min);
    this.setAttribute('role', 'spinbutton'); this.setAttribute('tabindex', '0');
    this.setAttribute('aria-label', this.getAttribute('label') || this.kind);
    this.setAttribute('aria-valuemin', this.range.min); this.setAttribute('aria-valuemax', this.range.max);
    this.innerHTML = '<div class="wheel-band" aria-hidden="true"></div><div class="wheel-track" aria-hidden="true"></div>';
    this.track = this.querySelector('.wheel-track');
    this.addEventListener('keydown', event => {
      const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
      if (event.key in steps) { event.preventDefault(); this.choose(this._value + steps[event.key] * this.range.step); }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); this.choose(event.key === 'Home' ? this.range.min : this.range.max); }
    });
    this.addEventListener('wheel', event => {
      event.preventDefault();
      this.wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
      if (Math.abs(this.wheelDelta) >= 24) { this.choose(this._value + Math.sign(this.wheelDelta) * this.range.step); this.wheelDelta = 0; }
    }, { passive: false });
    this.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.focus({ preventScroll: true });
      this.setPointerCapture(event.pointerId);
      this.drag = { y: event.clientY, value: this._value, moved: false };
      this.classList.add('dragging');
    });
    this.addEventListener('pointermove', event => {
      if (!this.drag) return;
      const diff = this.drag.y - event.clientY;
      if (Math.abs(diff) > 5) this.drag.moved = true;
      if (this.drag.moved) {
        const rows = diff / 44, nearest = Math.round(rows);
        this.choose(this.drag.value + nearest * this.range.step);
        const atEdge = this._value === this.range.min || this._value === this.range.max;
        this.track.style.transform = atEdge ? '' : `translateY(${(nearest - rows) * 44}px)`;
      }
    });
    const finish = event => {
      if (!this.drag) return;
      if (!this.drag.moved && event.type === 'pointerup') {
        const bounds = this.getBoundingClientRect();
        const offset = Math.round((event.clientY - bounds.top - bounds.height / 2) / 44);
        this.choose(this._value + offset * this.range.step);
      }
      this.drag = null; this.track.style.transform = ''; this.classList.remove('dragging');
    };
    this.addEventListener('pointerup', finish); this.addEventListener('pointercancel', finish); this.addEventListener('lostpointercapture', finish);
    this.render();
  }
  get value() { return this._value; }
  set value(value) { this._value = Math.max(this.range.min, Math.min(this.range.max, value)); this.render(); }
  choose(value) {
    const next = Math.max(this.range.min, Math.min(this.range.max, Math.round(value / this.range.step) * this.range.step));
    if (this._value === next) return;
    this._value = next; this.render(); this.dispatchEvent(new CustomEvent('valuechange', { detail: next, bubbles: true }));
  }
  render() {
    if (!this.track) return;
    this.setAttribute('aria-valuenow', this._value);
    this.setAttribute('aria-valuetext', `${number(this._value)}${this.kind === 'weight' ? ' kilograms, total external load' : ` ${this.kind}`}`);
    this.track.innerHTML = [-2, -1, 0, 1, 2].map(offset => {
      const value = this._value + offset * this.range.step;
      return `<span class="wheel-number distance-${Math.abs(offset)}">${value < this.range.min || value > this.range.max ? '' : number(value)}</span>`;
    }).join('');
  }
}
customElements.define('number-wheel', NumberWheel);
