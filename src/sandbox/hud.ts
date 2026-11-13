// What is drawn over the picture: the build, the aim, what is in hand, and
// the readings of whoever is being looked at, as a bedside monitor would give
// them, with what has been done to them under it.

import { ARMS } from './weapons.ts';

const add = (parent, cls, html = '') => {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    parent.appendChild(el);
    return el;
};

export class Hud {
    declare layer: HTMLElement;
    declare arms: HTMLElement;
    declare ammo: HTMLElement;
    declare monitor: HTMLElement;
    declare help: HTMLElement;
    declare fault: HTMLElement;
    declare _last: string;
    declare prompt: HTMLElement;
    declare carried: HTMLElement;
    declare _bar: string;
    declare weapons: any;

    constructor(layer: HTMLElement) {
        this.layer = layer;
        add(layer, 'version', `Cold Chain ${__VERSION__}`);
        add(layer, 'aim');
        this.arms = add(layer, 'arms');
        this.prompt = add(layer, 'prompt');
        this.ammo = add(layer, 'ammo');
        this.carried = add(layer, 'carried gone');
        this._bar = '';
        this.monitor = add(layer, 'monitor');
        this.help = add(layer, 'help', [
            'Left click: fire, stab, swing, grab or throw. Right click: cut with a blade, punch with your hands, or change what you throw.',
            '1 to 6 or the mouse wheel: change what you hold. R: reload. E: take from the wall. G: put it back. Tab: what you carry.',
            'N: another person where you are looking. X: see inside them. K: clear the room. H: hide this.',
        ].map((l) => `<p>${l}</p>`).join(''));
        this.fault = add(layer, 'fault');
        this._last = '';
        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyH') this.help.classList.toggle('gone');
            if (e.code === 'Tab' && this.weapons) this._toggle();
        });
    }

    // The inventory: what is at hand and in the bag, dragged from place to place. The pointer is freed while it is open.
    _toggle() {
        const open = this.carried.classList.toggle('gone') === false;
        const canvas = this.weapons.world.canvas;
        if (open) { document.exitPointerLock(); this._carried(); } else canvas.requestPointerLock();
    }

    _carried() {
        const w = this.weapons, name = (key) => ARMS.find((a) => a.key === key)?.name ?? '';
        const place = (list, i, key, n = '') => `<div class="place${key ? '' : ' empty'}${list === 'slots' && i === w.slot ? ' on' : ''}" data-list="${list}" data-i="${i}"`
            + `${key ? ' draggable="true"' : ''}>${n ? `<b>${n}</b>` : ''}${key ? name(key) : ''}</div>`;
        this.carried.innerHTML = '<h2>At hand</h2><div class="row">' + w.slots.map((k, i) => place('slots', i, k, String(i + 1))).join('') + '</div>'
            + '<h2>In the bag</h2><div class="row bag">' + w.bag.map((k, i) => place('bag', i, k)).join('') + '</div>'
            + '<p>Drag to move or swap. Tab to go back.</p>';
        let from = null;
        for (const el of this.carried.querySelectorAll<HTMLElement>('.place')) {
            el.addEventListener('dragstart', () => { from = el.dataset; });
            el.addEventListener('dragover', (e) => e.preventDefault());
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                if (!from) return;
                w.move(from.list, Number(from.i), el.dataset.list as any, Number(el.dataset.i));
                this._carried();
            });
        }
    }

    // `weapons` the Weapons, `npc` whoever is looked at (or was last hurt), `label` what to call them.
    update(weapons, npc, label) {
        this.weapons = weapons;
        const name = (key) => ARMS.find((a) => a.key === key)?.name;
        const bar = weapons.slots.map((key, i) => `<span class="${i === weapons.slot ? 'on' : ''}${key ? '' : ' empty'}"><b>${i + 1}</b> ${key ? name(key) : 'Hands'}</span>`).join('');
        if (bar !== this._bar) { this.arms.innerHTML = bar; this._bar = bar; }
        const on = document.pointerLockElement ? weapons.looking() : null;
        const prompt = on ? `<b>E</b> ${weapons.slots.includes(on) ? 'Hold' : weapons.slots.includes(null) ? 'Take' : 'Swap for'} the ${name(on)}` : '';
        if (this.prompt.innerHTML !== prompt) this.prompt.innerHTML = prompt;
        const arm = weapons.arm;
        this.ammo.textContent = arm.gun ? (weapons.reloading > 0 ? 'Reloading' : `${weapons.ammo.get(arm.key)} / ${arm.gun.rounds}`)
            : arm.kind === 'throw' ? `Throwing a ${weapons.throwing}` : '';
        const html = npc ? this._monitor(npc, label) : '';
        if (html !== this._last) { this.monitor.innerHTML = html; this._last = html; }
    }

    _monitor(npc, label) {
        const v = npc.vitals;
        const row = (name, value, warn = false) => `<tr${warn ? ' class="warn"' : ''}><td>${name}</td><td>${value}</td></tr>`;
        const litres = v.full - v.volume;
        const injuries = v.injuries.slice(0, 8).map((i) => `<li>${i.text}</li>`).join('');
        const more = v.injuries.length > 8 ? `<li>and ${v.injuries.length - 8} more</li>` : '';
        return `<h2>${label}</h2><p class="state${v.dead || !v.beating ? ' warn' : ''}">${v.state}</p><table>`
            + row('Heart rate', v.beating ? `${Math.round(v.hr)} bpm` : 'none', !v.beating || v.hr > 120)
            + row('Blood pressure', v.beating ? `${v.systolic}/${v.diastolic}` : 'none', v.map < 65)
            + row('Oxygen', `${Math.round(v.spo2)}%`, v.spo2 < 90)
            + row('Breathing', v.breathing && v.beating ? `${Math.round(v.rr)} a minute` : 'none', !v.breathing)
            + row('Blood lost', `${litres.toFixed(2)} L of ${v.full.toFixed(1)}`, v.lost > 0.15)
            + `</table>${injuries || more ? `<ul>${injuries}${more}</ul>` : ''}`;
    }

    error(e) { this.fault.textContent = String(e?.stack ?? e).split('\n').slice(0, 3).join(' '); }
}
