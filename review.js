/* Scopix V1.5: local spaced repetition. Does not change V1.4 storage key. */
const SCOPIX_REVIEW_DAY = 86400000;
const SCOPIX_REVIEW_AGAIN = 10 * 60000;
const SCOPIX_REVIEW_SESSION_MAX = 20;
let scopixReviewQueue = [];
let scopixReviewPointer = 0;
let scopixReviewRevealed = false;
let scopixReviewResults = {again:0, hard:0, good:0, easy:0};
let scopixReviewReturnFocus = null;

// Pure schedule function: intervals are transparent and capped at 365 days.
// "Again": repeat in 10 minutes; Hard: short interval; Good: expanding interval; Easy: longer interval.
function calculateScopixNextReview(previous, rating, now = Date.now()) {
    const old = previous && typeof previous === 'object' ? previous : {};
    const oldDays = Number.isFinite(old.intervalDays) && old.intervalDays > 0 ? old.intervalDays : 0;
    const previousReps = Number.isInteger(old.repetitions) && old.repetitions >= 0 ? old.repetitions : 0;
    const previousEase = Number.isFinite(old.ease) ? Math.min(2.8, Math.max(1.3, old.ease)) : 2.3;
    let intervalDays, ease = previousEase, repetitions = previousReps;
    if (rating === 'again') {
        intervalDays = 1 / 144;
        repetitions = 0;
        ease = Math.max(1.3, previousEase - 0.2);
    } else if (rating === 'hard') {
        intervalDays = oldDays < 1 ? 1 : Math.max(1, Math.ceil(oldDays * 1.2));
        ease = Math.max(1.3, previousEase - 0.15);
        repetitions += 1;
    } else if (rating === 'good') {
        intervalDays = oldDays < 1 ? 1 : Math.max(2, Math.ceil(oldDays * previousEase));
        repetitions += 1;
    } else if (rating === 'easy') {
        intervalDays = oldDays < 1 ? 3 : Math.max(3, Math.ceil(oldDays * previousEase * 1.3));
        ease = Math.min(2.8, previousEase + 0.15);
        repetitions += 1;
    } else {
        throw new Error('Invalid review rating');
    }
    intervalDays = Math.min(365, intervalDays);
    const delay = rating === 'again' ? SCOPIX_REVIEW_AGAIN : Math.round(intervalDays * SCOPIX_REVIEW_DAY);
    return {
        intervalDays,
        repetitions,
        ease,
        dueAt: now + delay,
        lastReviewedAt: now,
        reviews: (Number.isInteger(old.reviews) && old.reviews >= 0 ? old.reviews : 0) + 1,
        lapses: (Number.isInteger(old.lapses) && old.lapses >= 0 ? old.lapses : 0) + (rating === 'again' ? 1 : 0),
        lastRating: rating
    };
}

function scopixWordDueAt(word) {
    const due = Number(word?.review?.dueAt);
    if (Number.isFinite(due) && due > 0) return due;
    // Legacy V1.4 words have no review schedule: offer them immediately.
    return Number.isFinite(word?.createdAt) ? word.createdAt : 0;
}

function getScopixDueWords(now=Date.now()) {
    if (typeof scopixVocabulary === 'undefined') return [];
    return scopixVocabulary.filter(w => scopixWordDueAt(w) <= now)
        .slice().sort((a,b) => scopixWordDueAt(a)-scopixWordDueAt(b));
}

function formatScopixDue(ms) {
    if (!Number.isFinite(ms)) return '尚未安排';
    return new Date(ms).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

function updateScopixReviewCounts() {
    const count = getScopixDueWords().length;
    document.querySelectorAll('.scopix-review-count').forEach(el => {el.textContent=String(count);});
    const dashboard = document.getElementById('scopixReviewDashboard');
    if (dashboard) {
        const nextDue = (typeof scopixVocabulary !== 'undefined' ? scopixVocabulary : [])
            .map(scopixWordDueAt).filter(ms=>ms>Date.now()).sort((a,b)=>a-b)[0];
        dashboard.textContent = count
            ? '今天有 ' + count + ' 个待复习词汇'
            : '目前没有到期词汇' + (nextDue ? ' · 下次：' + formatScopixDue(nextDue) : '');
    }
    const studyDue = document.getElementById('scopixStudyDueCount');
    if (studyDue) studyDue.textContent=String(count);
}

function openScopixReview() {
    const panel = document.getElementById('scopixReviewPanel');
    if (!panel) return;
    if (typeof closeScopixStudyPanel==='function') closeScopixStudyPanel();
    if (typeof closeScopixAnnotationSidebar==='function') closeScopixAnnotationSidebar();
    scopixReviewReturnFocus = document.activeElement;
    scopixReviewQueue = getScopixDueWords().slice(0, SCOPIX_REVIEW_SESSION_MAX).map(w=>w.id);
    scopixReviewPointer = 0;
    scopixReviewRevealed = false;
    scopixReviewResults = {again:0, hard:0, good:0, easy:0};
    panel.hidden=false;
    document.getElementById('scopixReviewOverlay').hidden=false;
    document.body.classList.add('scopix-review-open');
    renderScopixReview();
    document.getElementById('scopixReviewClose')?.focus();
}

function closeScopixReview() {
    const panel=document.getElementById('scopixReviewPanel');
    if (!panel || panel.hidden) return;
    panel.hidden=true;
    document.getElementById('scopixReviewOverlay').hidden=true;
    document.body.classList.remove('scopix-review-open');
    updateScopixReviewCounts();
    if (scopixReviewReturnFocus?.isConnected) scopixReviewReturnFocus.focus();
    scopixReviewReturnFocus=null;
}

function makeReviewText(element, text) {
    element.textContent = text || '';
}

function renderScopixReview() {
    const current = document.getElementById('scopixReviewCurrent');
    const results = document.getElementById('scopixReviewComplete');
    const progress = document.getElementById('scopixReviewProgress');
    if (!current || !results) return;
    const total=scopixReviewQueue.length;
    const word=scopixVocabulary.find(w=>w.id===scopixReviewQueue[scopixReviewPointer]);
    progress.textContent = total ? (Math.min(scopixReviewPointer+1,total)+' / '+total) : '0 / 0';
    if (!word) {
        current.hidden=true;
        results.hidden=false;
        const completed = Object.values(scopixReviewResults).reduce((a,b)=>a+b,0);
        makeReviewText(document.getElementById('scopixReviewSummary'),
            total ? '本轮完成 '+completed+' 张卡片；仍有 '+getScopixDueWords().length+' 个到期词汇。'
                  : '目前没有到期词汇。新收藏的单词会进入复习队列。');
        makeReviewText(document.getElementById('scopixReviewRatingStats'),
            '不记得 '+scopixReviewResults.again+' · 模糊 '+scopixReviewResults.hard+
            ' · 记得 '+scopixReviewResults.good+' · 很熟悉 '+scopixReviewResults.easy);
        updateScopixReviewCounts();
        return;
    }
    current.hidden=false;
    results.hidden=true;
    makeReviewText(document.getElementById('scopixReviewWord'), word.word);
    makeReviewText(document.getElementById('scopixReviewSource'), word.articleTitle || '个人生词');
    makeReviewText(document.getElementById('scopixReviewContext'), word.context || '暂无文章来源句子');
    makeReviewText(document.getElementById('scopixReviewMeaning'), word.meaning || '暂无中文释义，可回到文章查词确认');
    document.getElementById('scopixReviewAnswer').hidden=!scopixReviewRevealed;
    document.getElementById('scopixReviewReveal').hidden=scopixReviewRevealed;
}

function revealScopixReview() {
    scopixReviewRevealed=true;
    renderScopixReview();
}

function answerScopixReview(rating) {
    if (!scopixReviewRevealed || !['again','hard','good','easy'].includes(rating)) return;
    const id=scopixReviewQueue[scopixReviewPointer];
    const word=scopixVocabulary.find(w=>w.id===id);
    if (!word) return;
    const review=calculateScopixNextReview(word.review,rating);
    const updated=scopixVocabulary.map(w=>w.id===id
        ? {...w,review,learned:rating==='good'||rating==='easy'}
        : w);
    if (!persistScopixVocabulary(updated)) return;
    scopixReviewResults[rating]++;
    scopixReviewPointer++;
    scopixReviewRevealed=false;
    renderScopixReview();
}

document.addEventListener('keydown', e=>{
    const panel=document.getElementById('scopixReviewPanel');
    if (!panel || panel.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeScopixReview(); return; }
    if (e.key==='Tab') {
        const controls=[...panel.querySelectorAll('button:not([disabled])')]
            .filter(el=>el.getClientRects().length>0);
        if (controls.length) {
            const first=controls[0],last=controls[controls.length-1];
            if (e.shiftKey && document.activeElement===first) {e.preventDefault();last.focus();}
            else if (!e.shiftKey && document.activeElement===last) {e.preventDefault();first.focus();}
        }
    }
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||'')) return;
    if (e.key===' ' && !scopixReviewRevealed && scopixReviewPointer<scopixReviewQueue.length) {
        e.preventDefault(); revealScopixReview();
    }
});

window.addEventListener('DOMContentLoaded', updateScopixReviewCounts);
