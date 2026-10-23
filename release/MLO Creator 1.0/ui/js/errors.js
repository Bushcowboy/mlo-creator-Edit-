// What happens when something goes wrong: a plain banner for the person using the program, and the details kept for whoever fixes it
// (the "Copy details" button, and a line in logs\errors.log next to the program when the program is new enough to take it).
// Loaded first, so it also catches errors while the other scripts load.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const TOKEN = (document.querySelector('meta[name="mlo-token"]') || {}).content || '';
    const crumbs = [], seen = new Map(); let bar = null, current = null;

    const state = () => (M.Model && M.Model.state) || null;
    // a short trail of what the person did last, so the details say what led to the error
    function crumb(text) { crumbs.push(new Date().toTimeString().slice(0, 8) + ' ' + text); if (crumbs.length > 12) crumbs.shift(); }

    function context() {
        const S = state(), c = { page: location.pathname };
        if (S) { c.tab = S.tab; c.project = S.project && (S.project.kind + ' "' + S.project.name + '"'); c.tool = S.project && S.project.kind === 'import' ? S.shellTool : (S.project && S.project.kind === 'vanilla' ? S.shellTool : S.tool); c.unsaved = !S.saved; }
        return c;
    }
    function text(rep) {
        const c = rep.context;
        return ['MLO Creator error (' + rep.area + ')' + (rep.count > 1 ? ' x' + rep.count : ''), rep.message, rep.stack || '', 'tab: ' + c.tab + ', tool: ' + c.tool + ', project: ' + c.project + (c.unsaved ? ' (had unsaved changes)' : ''), 'last actions:', ...crumbs.map(x => '  ' + x)].join('\n');
    }
    // fire and forget: the program writes it to logs\errors.log; an older program answers 404 and that is fine
    function send(rep) {
        try { fetch('/api/log', { method: 'POST', headers: { 'X-Mlo-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ area: rep.area, count: rep.count, message: rep.message, stack: (rep.stack || '').split('\n').slice(0, 8), context: rep.context, crumbs: crumbs.slice(-8) }) }).catch(() => { }); } catch (e) { }
    }

    const PLAIN = {
        overlay: (c) => 'Something went wrong while drawing the ' + (c.tool || 'current') + ' tool. Its on-screen guides are off; switch tool or press Esc to carry on.',
        save: () => 'Your project could not be saved. Press Save (Ctrl+S) to try again, and do not close the program yet.',
        loading: () => 'Something went wrong while reading the model files.',
        editor: () => 'Something went wrong in the editor.'
    };

    function build() {
        const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
        bar = el('div'); bar.id = 'errbar'; bar.hidden = true;
        const msg = el('div', 'msg'), safe = el('div', 'safe'), det = el('pre', 'det'), row = el('div', 'btns');
        det.hidden = true;
        const mk = (label, fn) => { const b = el('button', 'btn sm', label); b.addEventListener('click', fn); return b; };
        row.append(
            mk('Details', () => { det.hidden = !det.hidden; }),
            mk('Copy details', () => { const t = current ? text(current) : ''; try { navigator.clipboard.writeText(t); } catch (e) { } const s = row.querySelector('.copied'); if (s) s.textContent = 'Copied'; }),
            mk('Dismiss', () => { bar.hidden = true; }));
        const copied = el('span', 'copied note'); row.append(copied);
        bar.append(msg, safe, det, row); document.body.append(bar);
        bar._msg = msg; bar._safe = safe; bar._det = det; bar._copied = copied;
    }
    function show(rep) {
        if (!document.body) { window.addEventListener('DOMContentLoaded', () => show(rep)); return; }
        if (!bar) build();
        const S = state(), kind = PLAIN[rep.area] ? rep.area : 'editor';
        bar._msg.textContent = PLAIN[kind](rep.context) + (rep.count > 1 ? '  (' + rep.count + ' times)' : '');
        // the project is only "safe" when the autosave still works: after a save problem the message says what to do instead
        bar._safe.textContent = kind === 'save' ? '' : 'Your project is safe: it saves by itself' + (S && S.saved === false ? ' (the last change is being saved)' : '') + '.';
        bar._det.textContent = text(rep); bar._copied.textContent = ''; bar.hidden = false;
    }

    // area: where it happened (overlay, save, loading, hint, ...); opts.quiet = log it without a banner; opts.once = same error is reported only once
    function report(area, err, opts) {
        opts = opts || {};
        const e = err && err.message ? err : new Error(String(err)), key = area + '|' + e.message, now = Date.now();
        let rep = seen.get(key);
        if (rep && now - rep.at < 60000) { rep.count++; rep.at = now; if (rep.count === 2 || /^10+$/.test(String(rep.count))) send(rep); if (!opts.quiet && !bar?.hidden && current === rep) show(rep); return rep; }
        rep = { area, message: e.message, stack: e.stack || '', count: 1, at: now, context: context() }; seen.set(key, rep); current = opts.quiet ? current : rep;
        try { console.error('[' + area + ']', e); } catch (x) { }
        send(rep); if (!opts.quiet) show(rep);
        return rep;
    }

    window.addEventListener('error', (ev) => {
        const m = ev && ev.message || ''; if (/ResizeObserver loop|^Script error\.?$/.test(m)) return;
        report('editor', ev.error || new Error(m));
    });
    window.addEventListener('unhandledrejection', (ev) => { const r = ev && ev.reason; report('editor', r && r.message ? r : new Error(String(r))); });

    // the cause is gone (a save worked again): take that banner down
    function clear(area) { if (bar && current && current.area === area) bar.hidden = true; seen.forEach((v, k) => { if (v.area === area) seen.delete(k); }); }

    M.Errors = { report, crumb, clear, text: () => (current ? text(current) : ''), recent: () => crumbs.slice() };
})(window.MLO);
