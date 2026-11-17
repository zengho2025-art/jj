/* Scopix V1.3 - local reading annotations. No third-party requests. */
const SCOPIX_MARKS_KEY = 'scopix_annotations_v1';
const SCOPIX_MARK_COLORS = ['yellow','green','blue','pink','underline'];
let scopixAnnotationMode = false;
let scopixMarks = readScopixMarks();
let scopixSelected = null;
let scopixEditingId = null;

function readScopixMarks() {
    try {
        const raw = JSON.parse(localStorage.getItem(SCOPIX_MARKS_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter(m => m && typeof m.id === 'string' &&
            typeof m.articleId === 'string' && Number.isInteger(m.paragraph) &&
            Number.isInteger(m.start) && Number.isInteger(m.end) &&
            m.start >= 0 && m.end > m.start && typeof m.text === 'string' &&
            SCOPIX_MARK_COLORS.includes(m.color)).slice(0,500) : [];
    } catch (_) { return []; }
}

function persistScopixMarks(items) {
    try {
        localStorage.setItem(SCOPIX_MARKS_KEY, JSON.stringify(items));
        scopixMarks = items;
        return true;
    } catch (_) {
        alert('保存失败：浏览器存储不可用或空间不足。');
        return false;
    }
}

function toggleAnnotationMode() {
    scopixAnnotationMode = !scopixAnnotationMode;
    document.body.classList.toggle('annotation-mode', scopixAnnotationMode);
    document.querySelectorAll('.annotation-toggle').forEach(b => {
        b.textContent = scopixAnnotationMode ? '✓ 退出批注模式' : '✍ 开启批注模式';
        b.setAttribute('aria-pressed', String(scopixAnnotationMode));
    });
    if (typeof closeAllTooltips === 'function') closeAllTooltips();
    closeAnnotationToolbar();
    window.getSelection()?.removeAllRanges();
}

function setupArticleAnnotations(article) {
    document.querySelectorAll('.annotation-reader').forEach(reader => {
        const i = Number(reader.dataset.paragraph);
        const p = article.paragraphs[i];
        const text = typeof p.englishText === 'string' && p.englishText.trim() ?
            p.englishText : (p.wordTokens || []).map(t => t.word).join(' ');
        reader.dataset.articleId = String(article.id);
        reader.dataset.source = text;
        renderScopixMarks(reader);
    });
    document.body.classList.toggle('annotation-mode', scopixAnnotationMode);
    document.querySelectorAll('.annotation-toggle').forEach(b => {
        b.textContent = scopixAnnotationMode ? '✓ 退出批注模式' : '✍ 开启批注模式';
        b.setAttribute('aria-pressed', String(scopixAnnotationMode));
    });
    closeAnnotationToolbar();
}

function renderScopixMarks(reader) {
    const text = reader.dataset.source || '';
    const marks = scopixMarks.filter(m => m.articleId === reader.dataset.articleId &&
        m.paragraph === Number(reader.dataset.paragraph) &&
        text.slice(m.start,m.end) === m.text).sort((a,b) => a.start - b.start);
    reader.replaceChildren();
    let pos = 0;
    for (const m of marks) {
        if (m.start < pos || m.end > text.length) continue;
        reader.append(document.createTextNode(text.slice(pos,m.start)));
        const span = document.createElement('span');
        span.className = 'annotation-mark';
        span.dataset.markId = m.id;
        span.dataset.color = m.color;
        span.textContent = m.text;
        span.title = m.note || '点击编辑批注';
        span.tabIndex = 0;
        span.setAttribute('role','button');
        span.setAttribute('aria-label','编辑标记');
        reader.append(span);
        pos = m.end;
    }
    reader.append(document.createTextNode(text.slice(pos)));
}

function refreshScopixMarks() {
    document.querySelectorAll('.annotation-reader').forEach(renderScopixMarks);
}

function closeAnnotationToolbar() {
    const bar = document.getElementById('scopixAnnotationToolbar');
    if (bar) bar.hidden = true;
    const editor = document.getElementById('scopixNoteEditor');
    if (editor) editor.hidden = true;
    scopixSelected = null;
    scopixEditingId = null;
}

function positionAnnotationToolbar(rect) {
    const bar = document.getElementById('scopixAnnotationToolbar');
    if (!bar) return;
    bar.hidden = false;
    document.getElementById('scopixNoteEditor').hidden = true;
    document.getElementById('scopixDeleteMark').hidden = !scopixEditingId;
    // Prefer above the selected text; fall back below when there is no room.
    const margin = 10;
    const width = bar.getBoundingClientRect().width;
    const height = bar.getBoundingClientRect().height;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const left = Math.max(margin, Math.min(rect.left, maxLeft));
    let top = rect.top - height - 10;
    if (top < margin) top = rect.bottom + 10;
    top = Math.max(margin, Math.min(top, Math.max(margin, window.innerHeight-height-margin)));
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
    showAnnotationFeedback('');
}

function captureScopixSelection() {
    if (!scopixAnnotationMode) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
    const reader = start?.closest('.annotation-reader');
    if (!reader || reader !== end?.closest('.annotation-reader')) return;
    const test = document.createRange();
    test.selectNodeContents(reader);
    test.setEnd(range.startContainer, range.startOffset);
    const startOffset = test.toString().length;
    test.setEnd(range.endContainer,range.endOffset);
    const endOffset = test.toString().length;
    if (endOffset <= startOffset || endOffset-startOffset > 1000) return;
    const text = reader.dataset.source.slice(startOffset,endOffset);
    if (!text.trim()) return;
    scopixSelected = {articleId:reader.dataset.articleId,paragraph:Number(reader.dataset.paragraph),
        start:startOffset,end:endOffset,text};
    scopixEditingId = null;
    positionAnnotationToolbar(range.getBoundingClientRect());
}

function openScopixMark(mark) {
    if (!scopixAnnotationMode) return;
    const m = scopixMarks.find(item => item.id === mark.dataset.markId);
    if (!m) return;
    scopixSelected = {articleId:m.articleId,paragraph:m.paragraph,start:m.start,end:m.end,text:m.text};
    scopixEditingId = m.id;
    positionAnnotationToolbar(mark.getBoundingClientRect());
}

function findOverlappingScopixMarks(target) {
    return scopixMarks.filter(m => m.articleId === target.articleId &&
        m.paragraph === target.paragraph && m.start < target.end && m.end > target.start);
}

function showAnnotationFeedback(message) {
    const tip = document.getElementById('scopixAnnotationFeedback');
    if (!tip) return;
    tip.textContent = message;
    tip.hidden = !message;
}

function handleOverlappingSelection() {
    const overlapping = findOverlappingScopixMarks(scopixSelected);
    if (!overlapping.length) return false;
    if (overlapping.length === 1) {
        // Selecting an existing mark (or part of it) edits that mark.
        const mark = overlapping[0];
        scopixEditingId = mark.id;
        scopixSelected = {articleId:mark.articleId,paragraph:mark.paragraph,
            start:mark.start,end:mark.end,text:mark.text};
        document.getElementById('scopixDeleteMark').hidden = false;
        showAnnotationFeedback('已选中已有高亮：当前操作将修改整条标记。');
        return false;
    }
    // Multiple overlapping marks should never be merged or overwritten silently.
    showAnnotationFeedback('选区包含多个已有高亮。请单击其中一条标记后修改。');
    return true;
}

function saveScopixMark(color, note, isNoteEdit) {
    if (!scopixSelected) return;
    const previous = scopixMarks.find(m => m.id === scopixEditingId);
    if (!previous && handleOverlappingSelection()) return;
    const resolvedPrevious = scopixMarks.find(m => m.id === scopixEditingId);
    const item = resolvedPrevious
        ? {...resolvedPrevious, color: isNoteEdit ? resolvedPrevious.color : color,
            note: isNoteEdit ? note : resolvedPrevious.note}
        : {...scopixSelected, id: Date.now()+'-'+Math.random().toString(36).slice(2),
            color, note: note || '', createdAt:Date.now()};
    const next = resolvedPrevious ? scopixMarks.map(m=>m.id===resolvedPrevious.id?item:m) : [...scopixMarks,item];
    if (!persistScopixMarks(next)) return;
    refreshScopixMarks();
    closeAnnotationToolbar();
    window.getSelection()?.removeAllRanges();
}

function colorScopixSelection(color) {
    if (!SCOPIX_MARK_COLORS.includes(color)) return;
    saveScopixMark(color,'',false);
}

function editScopixAnnotation() {
    if (!scopixSelected) return;
    if (!scopixEditingId && handleOverlappingSelection()) return;
    const previous = scopixMarks.find(m => m.id === scopixEditingId);
    document.getElementById('scopixNoteEditor').hidden = false;
    document.getElementById('scopixAnnotationNote').value = previous?.note || '';
    document.getElementById('scopixAnnotationNote').focus();
}

function saveScopixNote() {
    const note = document.getElementById('scopixAnnotationNote').value.trim();
    if (note.length > 2000) { alert('笔记最多 2000 字。'); return; }
    saveScopixMark('yellow',note,true);
}

function deleteScopixMark() {
    if (!scopixEditingId) return;
    if (!persistScopixMarks(scopixMarks.filter(m=>m.id!==scopixEditingId))) return;
    refreshScopixMarks();
    closeAnnotationToolbar();
}

document.addEventListener('mouseup', e => {
    if (!scopixAnnotationMode || e.target.closest('#scopixAnnotationToolbar')) return;
    setTimeout(captureScopixSelection, 0);
});
document.addEventListener('touchend', e => {
    if (scopixAnnotationMode && e.target.closest('.annotation-reader'))
        setTimeout(captureScopixSelection, 120);
}, {passive:true});
document.addEventListener('click', e => {
    if (!scopixAnnotationMode) return;
    const mark = e.target.closest('.annotation-mark');
    if (mark && window.getSelection()?.isCollapsed) { openScopixMark(mark); return; }
    if (!e.target.closest('#scopixAnnotationToolbar') && !e.target.closest('.annotation-reader'))
        closeAnnotationToolbar();
});
document.addEventListener('keydown', e => {
    if (!scopixAnnotationMode) return;
    if (e.key === 'Escape') closeAnnotationToolbar();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.annotation-mark')) {
        e.preventDefault(); openScopixMark(e.target);
    }
});
