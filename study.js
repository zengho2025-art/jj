/* Scopix V1.4 – personal vocabulary & annotation library (local-only) */
const SCOPIX_VOCAB_KEY = 'scopix_vocabulary_v1';
let scopixVocabulary = loadScopixVocabulary();
let scopixWordContext = null;
let scopixWordMeaning = '';
let scopixStudyTab = 'words';
let scopixStudyQuery = '';
let scopixStudyReturnFocus = null;

function loadScopixVocabulary() {
    try {
        const data = JSON.parse(localStorage.getItem(SCOPIX_VOCAB_KEY) || '[]');
        return Array.isArray(data) ? data.filter(item =>
            item && typeof item.id === 'string' && typeof item.word === 'string' &&
            typeof item.articleId === 'string' && typeof item.context === 'string'
        ).slice(0, 1500) : [];
    } catch (_) { return []; }
}

function persistScopixVocabulary(next) {
    try {
        localStorage.setItem(SCOPIX_VOCAB_KEY, JSON.stringify(next));
        scopixVocabulary = next;
        renderScopixStudyLibrary();
        updateScopixSaveWordButton();
        return true;
    } catch (_) {
        showScopixStudyFeedback('保存失败：本地存储空间不足或浏览器禁止保存。');
        return false;
    }
}

function activeScopixArticle() {
    const id = new URLSearchParams(location.search).get('id');
    return Array.isArray(allArticles) ? allArticles.find(a => String(a.id) === String(id)) : null;
}

function captureScopixWordContext(element) {
    const article = activeScopixArticle();
    const p = element?.closest('[data-study-paragraph]');
    const paragraph = p ? Number(p.dataset.studyParagraph) : -1;
    const source = article?.paragraphs?.[paragraph];
    scopixWordContext = {
        articleId: article ? String(article.id) : '',
        articleTitle: String(article?.title || ''),
        paragraph,
        context: String(source?.englishText || (source?.wordTokens || []).map(t => t.word).join(' ')).slice(0, 420)
    };
}

function prepareScopixDictionaryWord(word) {
    scopixWordMeaning = '';
    updateScopixSaveWordButton();
}

function setScopixWordMeaning(word, meaning) {
    const shown = document.getElementById('dictWord')?.textContent?.trim().toLowerCase();
    if (shown !== String(word).trim().toLowerCase()) return;
    scopixWordMeaning = String(meaning || '').slice(0, 300);
    updateScopixSaveWordButton();
}

function isScopixWordSaved(word, articleId) {
    return scopixVocabulary.some(item =>
        item.word.toLowerCase() === String(word).toLowerCase() &&
        item.articleId === String(articleId));
}

function updateScopixSaveWordButton() {
    const button = document.getElementById('scopixSaveWordBtn');
    if (!button) return;
    const word = document.getElementById('dictWord')?.textContent?.trim() || '';
    const article = activeScopixArticle();
    const articleId = scopixWordContext?.articleId || String(article?.id || '');
    const saved = Boolean(word && articleId && isScopixWordSaved(word, articleId));
    button.disabled = !word || !articleId;
    button.textContent = saved ? '✓ 已加入生词本' : '＋ 加入生词本';
    button.setAttribute('aria-label', button.textContent);
}

function saveScopixCurrentWord() {
    const word = document.getElementById('dictWord')?.textContent?.trim().slice(0, 100);
    const article = activeScopixArticle();
    const ctx = scopixWordContext;
    if (!word || !article || !ctx || ctx.articleId !== String(article.id)) {
        showScopixStudyFeedback('请在文章中双击或长按英文词语，然后再收藏。');
        return;
    }
    if (isScopixWordSaved(word, ctx.articleId)) {
        showScopixStudyFeedback('这篇文章中的该单词已经收藏。');
        return;
    }
    const item = {
        id: Date.now()+'-'+Math.random().toString(36).slice(2),
        word: word.toLowerCase(),
        meaning: scopixWordMeaning,
        articleId: ctx.articleId,
        articleTitle: ctx.articleTitle,
        paragraph: ctx.paragraph,
        context: ctx.context,
        learned: false,
        createdAt: Date.now()
    };
    if (persistScopixVocabulary([...scopixVocabulary, item])) {
        showScopixStudyFeedback('已收藏到个人生词本。');
    }
}

function showScopixStudyFeedback(message) {
    const el = document.getElementById('scopixStudyFeedback');
    if (el) {
        el.textContent = message;
        el.hidden = !message;
    }
}

function studyButton(label, callback, extraClass='') {
    const b = document.createElement('button');
    b.type='button';
    b.textContent=label;
    b.className='text-xs px-3 py-2 border border-sand rounded-lg hover:bg-wheat '+extraClass;
    b.addEventListener('click',callback);
    return b;
}

function makeStudyCard(title, meta, detail, actions) {
    const card=document.createElement('article');
    card.className='border border-sand rounded-xl bg-white p-3 space-y-2';
    const heading=document.createElement('h3');
    heading.className='font-semibold text-ink text-base break-words';
    heading.textContent=title;
    const line=document.createElement('p');
    line.className='text-xs text-sage';
    line.textContent=meta;
    card.append(heading,line);
    if (detail) {
        const desc=document.createElement('p');
        desc.className='text-sm text-gray-700 whitespace-pre-wrap break-words';
        desc.textContent=detail;
        card.append(desc);
    }
    const bar=document.createElement('div');
    bar.className='flex flex-wrap gap-2';
    for (const [label,callback,klass] of actions) bar.append(studyButton(label,callback,klass||''));
    card.append(bar);
    return card;
}

function getStudyAnnotations() {
    if (!Array.isArray(window.scopixMarks) && typeof scopixMarks === 'undefined') return [];
    const marks = typeof scopixMarks !== 'undefined' ? scopixMarks : window.scopixMarks;
    return marks.filter(m => {
        const article = allArticles.find(a=>String(a.id)===m.articleId);
        const p=article?.paragraphs?.[m.paragraph];
        const source=typeof p?.englishText==='string' && p.englishText.trim()
            ? p.englishText : (p?.wordTokens || []).map(t=>t.word).join(' ');
        return source.slice(m.start,m.end)===m.text;
    });
}

function setScopixStudyTab(tab) {
    scopixStudyTab = tab === 'notes' ? 'notes' : 'words';
    renderScopixStudyLibrary();
}

function renderScopixStudyLibrary() {
    const panel = document.getElementById('scopixStudyPanel');
    if (!panel) return;
    const list=document.getElementById('scopixStudyList');
    const notes=getStudyAnnotations();
    document.getElementById('scopixStudyWordCount').textContent=String(scopixVocabulary.length);
    document.getElementById('scopixStudyNoteCount').textContent=String(notes.length);
    const wordsBtn=document.getElementById('scopixTabWords');
    const notesBtn=document.getElementById('scopixTabNotes');
    wordsBtn.setAttribute('aria-selected',String(scopixStudyTab==='words'));
    notesBtn.setAttribute('aria-selected',String(scopixStudyTab==='notes'));
    wordsBtn.classList.toggle('active',scopixStudyTab==='words');
    notesBtn.classList.toggle('active',scopixStudyTab==='notes');
    list.setAttribute('aria-labelledby', scopixStudyTab==='words' ? 'scopixTabWords' : 'scopixTabNotes');
    list.replaceChildren();
    const query=scopixStudyQuery.trim().toLowerCase();
    if (scopixStudyTab==='words') {
        const words=scopixVocabulary.filter(w =>
            [w.word,w.meaning,w.context,w.articleTitle].some(x=>String(x||'').toLowerCase().includes(query))
        ).sort((a,b)=>b.createdAt-a.createdAt);
        for (const w of words) {
            const detail=[w.meaning,w.context].filter(Boolean).join('\n');
            list.append(makeStudyCard(w.word,
                (w.learned?'已掌握 · ':'待复习 · ')+(w.articleTitle||'未知文章'),
                detail, [
                    [w.learned?'标为待复习':'标记已掌握',()=>toggleScopixWordLearned(w.id)],
                    ['定位文章',()=>locateScopixWord(w.id)],
                    ['删除',()=>deleteScopixWord(w.id),'text-red-700']
                ]));
        }
        if (!words.length) emptyStudyList('还没有匹配的生词。可在文章里双击或长按词语后收藏。');
    } else {
        const filtered=notes.filter(n=>{
            const article=allArticles.find(a=>String(a.id)===n.articleId);
            return [n.text,n.note,article?.title].some(x=>String(x||'').toLowerCase().includes(query));
        }).sort((a,b)=>a.articleId.localeCompare(b.articleId)||a.paragraph-b.paragraph||a.start-b.start);
        for(const n of filtered) {
            const article=allArticles.find(a=>String(a.id)===n.articleId);
            list.append(makeStudyCard(n.text,
                (article?.title || '未知文章')+' · 第'+(n.paragraph+1)+'段',
                n.note||'（无文字批注）', [
                    ['定位原文',()=>locateScopixStudyNote(n.id)],
                    ['编辑批注',()=>locateScopixStudyNote(n.id,true)],
                    ['删除',()=>deleteScopixStudyNote(n.id),'text-red-700']
                ]));
        }
        if (!filtered.length) emptyStudyList('还没有匹配的阅读批注。');
    }
}

function emptyStudyList(text) {
    const p=document.createElement('p');
    p.className='p-4 bg-wheat/50 text-sage text-sm rounded-lg';
    p.textContent=text;
    document.getElementById('scopixStudyList').append(p);
}

function toggleScopixWordLearned(id) {
    const next=scopixVocabulary.map(w=>w.id===id?{...w,learned:!w.learned}:w);
    persistScopixVocabulary(next);
}

function deleteScopixWord(id) {
    if (!confirm('确定删除这条生词记录吗？')) return;
    persistScopixVocabulary(scopixVocabulary.filter(w=>w.id!==id));
}

function navigateScopixToArticle(id) {
    const article=allArticles.find(a=>String(a.id)===String(id));
    if (!article) {showScopixStudyFeedback('对应文章不存在或已从文章库移除。');return false;}
    if (typeof closeScopixAnnotationSidebar==='function') closeScopixAnnotationSidebar();
    viewArticle(article.id);
    return true;
}

function locateScopixWord(id) {
    const word=scopixVocabulary.find(w=>w.id===id);
    if (!word) return;
    closeScopixStudyPanel();
    if (!navigateScopixToArticle(word.articleId)) return;
    const target=document.querySelector('[data-study-paragraph="'+word.paragraph+'"]');
    target?.scrollIntoView({behavior:'smooth',block:'center'});
}

function locateScopixStudyNote(id, edit=false) {
    const mark=getStudyAnnotations().find(m=>m.id===id);
    if (!mark) return;
    closeScopixStudyPanel();
    if (!navigateScopixToArticle(mark.articleId)) return;
    if (typeof locateScopixMark === 'function') locateScopixMark(id,edit);
}

function deleteScopixStudyNote(id) {
    if (!confirm('确定删除此高亮与批注吗？')) return;
    if (typeof scopixMarks==='undefined' || typeof persistScopixMarks!=='function') return;
    if (!persistScopixMarks(scopixMarks.filter(m=>m.id!==id))) return;
    if (typeof refreshScopixMarks==='function') refreshScopixMarks();
    if (typeof renderScopixAnnotationSidebar==='function') renderScopixAnnotationSidebar();
    renderScopixStudyLibrary();
}

function openScopixStudyPanel() {
    const panel=document.getElementById('scopixStudyPanel');
    scopixStudyReturnFocus=document.activeElement;
    if (typeof closeScopixAnnotationSidebar==='function') closeScopixAnnotationSidebar();
    panel.hidden=false;
    document.getElementById('scopixStudyOverlay').hidden=false;
    document.body.classList.add('scopix-study-open');
    renderScopixStudyLibrary();
    document.getElementById('scopixStudyClose').focus();
}

function closeScopixStudyPanel() {
    const panel=document.getElementById('scopixStudyPanel');
    if (!panel || panel.hidden) return;
    panel.hidden=true;
    document.getElementById('scopixStudyOverlay').hidden=true;
    document.body.classList.remove('scopix-study-open');
    if (scopixStudyReturnFocus?.isConnected) scopixStudyReturnFocus.focus();
    scopixStudyReturnFocus=null;
}

function searchScopixStudy(value) {
    scopixStudyQuery=String(value||'');
    renderScopixStudyLibrary();
}

function exportScopixStudyData() {
    const payload={
        format:'Scopix V1.4 local learning export',
        exportedAt:new Date().toISOString(),
        vocabulary:scopixVocabulary,
        annotations:getStudyAnnotations()
    };
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const link=document.createElement('a');
    link.href=url;
    link.download='scopix-study-backup.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
}

document.addEventListener('keydown', e=>{
    const panel=document.getElementById('scopixStudyPanel');
    if (!panel || panel.hidden) return;
    if (e.key==='Escape') {e.preventDefault();closeScopixStudyPanel();return;}
    if (e.key!=='Tab') return;
    const controls=[...panel.querySelectorAll('button:not([disabled]),input:not([disabled])')];
    if (!controls.length) return;
    if (e.shiftKey && document.activeElement===controls[0]) {
        e.preventDefault();controls[controls.length-1].focus();
    } else if (!e.shiftKey && document.activeElement===controls[controls.length-1]) {
        e.preventDefault();controls[0].focus();
    }
});
