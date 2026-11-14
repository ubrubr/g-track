import { LIMITS, number } from './domain.js';

class NumberWheel extends HTMLElement {
    constructor() { super(); this._value = 0; this.wheelDelta = 0; }
    connectedCallback() {
      if (this.select) return;
      this.kind = this.getAttribute('kind');
      this.range = LIMITS[this.kind];
      this._value = this.clamp(Number(this.getAttribute('value') ?? this.range.min));
      const label = this.getAttribute('label') || this.kind;
      const options = [];
      for (let value = this.range.min; value <= this.range.max + this.range.step / 10; value += this.range.step) {
        options.push(`<option value="${value}">${number(value)}</option>`);
      }
      this.innerHTML = `<div class="wheel-control"><select class="wheel-select" aria-label="${label}">${options.join('')}</select><button class="wheel-type" type="button" aria-label="Type ${label.toLowerCase()} directly" title="Type a value">#</button><input class="wheel-direct" type="number" min="${this.range.min}" max="${this.range.max}" step="${this.range.step}" inputmode="decimal" aria-label="Type ${label.toLowerCase()}" hidden></div>`;
      this.select = this.querySelector('.wheel-select');
      this.typeButton = this.querySelector('.wheel-type');
      this.direct = this.querySelector('.wheel-direct');
      this.select.addEventListener('change', () => this.choose(Number(this.select.value)));
      this.typeButton.addEventListener('click', () => {
        this.select.hidden = true; this.typeButton.hidden = true; this.direct.hidden = false;
        this.direct.value = this._value; this.direct.focus({ preventScroll: true }); this.direct.select();
      });
      const commit = () => {
        if (this.direct.hidden) return;
        const entered = this.direct.value.trim();
        this.direct.hidden = true; this.select.hidden = false; this.typeButton.hidden = false;
        if (entered !== '') this.choose(Number(entered)); else this.render();
      };
      this.direct.addEventListener('change', commit);
      this.direct.addEventListener('blur', commit);
      this.direct.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); this.select.focus({ preventScroll: true }); }
        if (event.key === 'Escape') { event.preventDefault(); this.direct.value = this._value; commit(); this.select.focus({ preventScroll: true }); }
      });
      this.addEventListener('keydown', event => {
        if (event.target === this.direct) return;
        const keys = { PageUp: 10, PageDown: -10, Home: null, End: null };
        if (event.key in keys) {
          event.preventDefault();
          this.choose(event.key === 'Home' ? this.range.min : event.key === 'End' ? this.range.max : this._value + keys[event.key] * this.range.step);
        }
      });
      this.addEventListener('wheel', event => {
        if (event.target === this.direct) return;
        event.preventDefault();
        this.wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
        const steps = Math.trunc(this.wheelDelta / 24);
        if (steps) {
          this.wheelDelta -= steps * 24;
          this.choose(this._value + steps * this.range.step);
        }
      }, { passive: false });
      this.render();
    }
    clamp(value) {
      if (!Number.isFinite(value)) return this.range.min;
      const steps = Math.round((value - this.range.min) / this.range.step);
      return Math.min(this.range.max, Math.max(this.range.min, Number((this.range.min + steps * this.range.step).toFixed(2))));
    }
    get value() { return this._value; }
    set value(value) { this._value = this.clamp(Number(value)); this.render(); }
    choose(value) {
      const next = this.clamp(value);
      if (next === this._value) { this.render(); return; }
      this._value = next;
      this.render();
      this.dispatchEvent(new CustomEvent('valuechange', { detail: next, bubbles: true }));
    }
    render() {
      if (!this.select) return;
      this.select.value = String(this._value);
      this.direct.value = String(this._value);
      this.select.setAttribute('aria-valuetext', number(this._value));
    }
  }
  customElements.define('number-wheel', NumberWheel);
