/* Scopix V1.3 - local reading annotations. No third-party requests. */
const SCOPIX_MARKS_KEY = 'scopix_annotations_v1';
const SCOPIX_MARK_COLORS = ['yellow','green','blue','pink','underline'];
let scopixAnnotationMode = false;
let scopixMarks = readScopixMarks();
let scopixSelected = null;
let scopixEditingId = null;
let scopixToolbarAnchor = null;

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
    closeScopixAnnotationSidebar();
    renderScopixAnnotationSidebar();
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
    scopixToolbarAnchor = null;
}

function repositionAnnotationToolbar() {
    const bar = document.getElementById('scopixAnnotationToolbar');
    const rect = scopixToolbarAnchor;
    if (!bar || bar.hidden || !rect) return;
    // Mobile: a fixed bottom sheet above the safe area avoids covering the selection.
    if (window.matchMedia('(max-width: 640px)').matches) {
        bar.style.left = '';
        bar.style.top = '';
        return;
    }
    const margin = 12;
    const width = bar.getBoundingClientRect().width;
    const height = bar.getBoundingClientRect().height;
    const left = Math.max(margin, Math.min(rect.left,
        Math.max(margin, window.innerWidth - width - margin)));
    let top = rect.top - height - margin;
    if (top < margin) top = rect.bottom + margin;
    top = Math.max(margin, Math.min(top,
        Math.max(margin, window.innerHeight - height - margin)));
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
}

function positionAnnotationToolbar(rect) {
    const bar = document.getElementById('scopixAnnotationToolbar');
    if (!bar) return;
    bar.hidden = false;
    document.getElementById('scopixNoteEditor').hidden = true;
    document.getElementById('scopixDeleteMark').hidden = !scopixEditingId;
    scopixToolbarAnchor = {
        left: rect.left, top: rect.top, bottom: rect.bottom
    };
    const selectedText = document.getElementById('scopixSelectedText');
    if (selectedText) selectedText.textContent = '已选中：' +
        (scopixSelected?.text || '').replace(/\s+/g,' ').trim().slice(0, 90);
    const heading = document.getElementById('scopixToolbarTitle');
    if (heading) heading.textContent = scopixEditingId ? '编辑已有批注' : '添加阅读批注';
    showAnnotationFeedback('');
    repositionAnnotationToolbar();
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
    renderScopixAnnotationSidebar();
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
    document.getElementById('scopixAnnotationNote').focus({preventScroll:true});
    repositionAnnotationToolbar();
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
    renderScopixAnnotationSidebar();
    closeAnnotationToolbar();
}


/* V1.3: Manage current article marks in a safe, local-only sidebar. */
let scopixSidebarReturnFocus = null;
function getArticleMarks() {
    const readers = [...document.querySelectorAll('.annotation-reader')];
    if (!readers.length) return [];
    const articleId = readers[0].dataset.articleId;
    return scopixMarks.filter(m => {
        const reader = readers.find(r => Number(r.dataset.paragraph) === m.paragraph);
        return m.articleId === articleId && reader &&
            (reader.dataset.source || '').slice(m.start,m.end) === m.text;
    }).sort((a,b) => a.paragraph-b.paragraph || a.start-b.start);
}
function makeSidebarAction(label, fn) {
    const button = document.createElement('button');
    button.type='button';
    button.className='text-xs rounded-md border border-sand px-2.5 py-2 text-moss hover:bg-wheat';
    button.textContent=label;
    button.addEventListener('click',fn);
    return button;
}
function renderScopixAnnotationSidebar() {
    const list = document.getElementById('scopixAnnotationList');
    if (!list) return;
    list.replaceChildren();
    const marks = getArticleMarks();
    document.querySelectorAll('.scopix-annotation-count').forEach(node => node.textContent=String(marks.length));
    document.getElementById('scopixDrawerCount').textContent=marks.length+' 条标记';
    if (!marks.length) {
        const empty=document.createElement('p');
        empty.className='p-4 rounded-lg bg-wheat/40 text-sm text-sage leading-relaxed';
        empty.textContent='这篇文章还没有批注。开启批注模式，选中英文即可添加高亮和笔记。';
        list.append(empty);
        return;
    }
    const palette={yellow:'#fde68a',green:'#a7f3d0',blue:'#bfdbfe',pink:'#fbcfe8',underline:'#e05353'};
    for (const mark of marks) {
        const card=document.createElement('div');
        card.className='border border-sand bg-white rounded-lg p-3 space-y-2';
        const header=document.createElement('div');
        header.className='flex items-center gap-2 text-xs text-sage';
        const indicator=document.createElement('span');
        indicator.className='w-3 h-3 rounded-full border border-sand inline-block shrink-0';
        indicator.style.backgroundColor=palette[mark.color] || palette.yellow;
        const pos=document.createElement('span');
        pos.textContent='第 '+(mark.paragraph+1)+' 段';
        header.append(indicator,pos);
        const text=document.createElement('p');
        text.className='text-sm text-ink leading-relaxed break-words';
        text.textContent=mark.text;
        card.append(header,text);
        if (mark.note) {
            const note=document.createElement('p');
            note.className='p-2 bg-wheat/50 rounded-md text-xs text-gray-700 whitespace-pre-wrap break-words';
            note.textContent=mark.note;
            card.append(note);
        }
        const actions=document.createElement('div');
        actions.className='flex gap-2 flex-wrap';
        actions.append(
            makeSidebarAction('定位原文',()=>locateScopixMark(mark.id,false)),
            makeSidebarAction('编辑',()=>locateScopixMark(mark.id,true)),
            makeSidebarAction('删除',()=>deleteSidebarMark(mark.id))
        );
        card.append(actions);
        list.append(card);
    }
}
function openScopixAnnotationSidebar() {
    const drawer=document.getElementById('scopixAnnotationSidebar');
    if (!drawer || !document.querySelector('.annotation-reader')) return;
    scopixSidebarReturnFocus=document.activeElement;
    closeAnnotationToolbar();
    renderScopixAnnotationSidebar();
    drawer.hidden=false;
    document.getElementById('scopixAnnotationOverlay').hidden=false;
    document.body.classList.add('scopix-drawer-open');
    document.getElementById('scopixDrawerClose').focus();
}
function closeScopixAnnotationSidebar() {
    const drawer=document.getElementById('scopixAnnotationSidebar');
    if (!drawer || drawer.hidden) return;
    drawer.hidden=true;
    document.getElementById('scopixAnnotationOverlay').hidden=true;
    document.body.classList.remove('scopix-drawer-open');
    if (scopixSidebarReturnFocus?.isConnected) scopixSidebarReturnFocus.focus();
    scopixSidebarReturnFocus=null;
}
function locateScopixMark(id,edit) {
    const markData=getArticleMarks().find(m=>m.id===id);
    if (!markData) return;
    if (!scopixAnnotationMode) toggleAnnotationMode();
    closeScopixAnnotationSidebar();
    const reader=[...document.querySelectorAll('.annotation-reader')].find(r=>
        r.dataset.articleId===markData.articleId && Number(r.dataset.paragraph)===markData.paragraph);
    const mark=[...(reader?.querySelectorAll('.annotation-mark')||[])].find(el=>el.dataset.markId===id);
    if (!mark) return;
    mark.scrollIntoView({behavior:'smooth',block:'center'});
    mark.focus({preventScroll:true});
    // Open after scrolling settles enough to calculate a meaningful anchor.
    setTimeout(()=>{
        if (!mark.isConnected || !scopixAnnotationMode) return;
        openScopixMark(mark);
        if (edit) editScopixAnnotation();
    },350);
}
function deleteSidebarMark(id) {
    if (!getArticleMarks().some(m=>m.id===id)) return;
    if (!confirm('确定删除此高亮和对应的笔记吗？')) return;
    if (!persistScopixMarks(scopixMarks.filter(m=>m.id!==id))) return;
    refreshScopixMarks();
    renderScopixAnnotationSidebar();
}
document.addEventListener('keydown',event=>{
    const drawer=document.getElementById('scopixAnnotationSidebar');
    if (!drawer || drawer.hidden) return;
    if (event.key==='Escape') {
        event.preventDefault();
        closeScopixAnnotationSidebar();
        return;
    }
    if (event.key!=='Tab') return;
    const buttons=[...drawer.querySelectorAll('button:not([disabled])')];
    if (!buttons.length) return;
    const first=buttons[0],last=buttons[buttons.length-1];
    if (event.shiftKey && document.activeElement===first) {event.preventDefault();last.focus();}
    if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
});

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
    if (mark && window.getSelection()?.isCollapsed) {
        openScopixMark(mark);
        return;
    }
    if (e.target.closest('#scopixAnnotationToolbar')) return;
    // Clicking plain text without selecting a range closes stale toolbars.
    if (window.getSelection()?.isCollapsed) closeAnnotationToolbar();
});
window.addEventListener('resize', repositionAnnotationToolbar);

document.addEventListener('keydown', e => {
    if (!scopixAnnotationMode) return;
    if (e.key === 'Escape') closeAnnotationToolbar();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.annotation-mark')) {
        e.preventDefault(); openScopixMark(e.target);
    }
});
