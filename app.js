(() => {
  "use strict";
  const DB_NAME = "LexiLab-vocabulary";
  const DB_VERSION = 1;
  const STORE = "words";
  let db;
  let words = [];
  let currentView = "library";
  let toastTimer;
  let flashSet = [], flashIndex = 0, flashRevealed = false, flashSession = {count:0,known:0};
  let spellSet = [], spellIndex = 0, spellChecked = false, spellSession = {attempts:0,correct:0};
  let quizSet = [], quizIndex = 0, quizAnswered = false, quizSession = {attempts:0,correct:0};
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const makeId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const now = () => new Date().toISOString();
  const shuffle = arr => { const copy = [...arr]; for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];} return copy; };
  const clean = value => String(value ?? "").trim();
  const normalize = value => clean(value).normalize("NFC");
  const meaning = word =>
    word.meaning ||
    word.translation ||
    word.definition ||
    "No meaning added";
  const reviewed = word => (word.status === "review" || (word.spellingMistakes || 0) > 0);
  function showToast(message, error=false) {
    const el=$("toast"); el.textContent=message; el.classList.toggle("error",error); el.classList.add("show");
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),3200);
  }
  function openDatabase() {
    return new Promise((resolve,reject)=>{
      if(!("indexedDB" in window)){reject(new Error("This browser does not support IndexedDB."));return;}
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{const database=request.result;if(!database.objectStoreNames.contains(STORE)){const store=database.createObjectStore(STORE,{keyPath:"id"});store.createIndex("word","word",{unique:false});store.createIndex("status","status",{unique:false});}};
      request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
    });
  }
  function transaction(mode="readonly") { return db.transaction(STORE,mode).objectStore(STORE); }
  function getAll() { return new Promise((resolve,reject)=>{const r=transaction().getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);}); }
  function putWord(word) { return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(word);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Save failed"));}); }
  function deleteWord(id) { return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); }
  async function reloadWords() { words=await getAll(); words.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")); renderAll(); }
  async function saveAndRefresh(word,message="Saved.") { try{await putWord(word);await reloadWords();showToast(message);}catch(e){showToast("Could not save this change. Export a backup and check available browser storage.",true);console.error(e);} }
  function renderAll(){renderStats();renderLibrary();renderReview();$("sidebar-total").textContent=words.length;$("mistake-count").textContent=words.filter(reviewed).length;}
  function renderStats(){
    $("stat-total").textContent=words.length;
    $("stat-known").textContent=words.filter(w=>w.status==="known").length;
    $("stat-review").textContent=words.filter(reviewed).length;
    const attempts=words.reduce((s,w)=>s+(w.spellingAttempts||0),0), correct=words.reduce((s,w)=>s+(w.spellingCorrect||0),0);
    $("stat-accuracy").textContent=attempts?`${Math.round(correct/attempts*100)}%`:"—";
    $("stat-attempts").textContent=attempts?`${attempts} spelling attempts`:"No attempts yet";
  }
  function renderLibrary(){
    const query=clean($("search-input").value).toLocaleLowerCase();
    const filter=$("filter-select").value;
    const filtered=words.filter(w=>{
      const text = [
        w.word,
        w.meaning,
        w.definition,
        w.translation,
        w.notes,
        (w.tags || []).join(" "),
        w.example
      ].join(" ").toLocaleLowerCase();
      return (!query||text.includes(query))&&(filter==="all"||(filter==="review"?reviewed(w):w.status==="known"));
    });
    $("word-table-body").innerHTML=filtered.map(w=>`<tr>
      <td>
        <div class="word-main">${escapeHtml(w.word)}</div>
      </td>
      <td>
        <div class="definition-cell">${escapeHtml(meaning(w))}</div>
        ${w.example ? `<div class="word-sub">${escapeHtml(w.example)}</div>` : ""}
      </td>
      <td><span class="status-pill ${w.status==="known"?"known":reviewed(w)?"review":""}">${w.status==="known"?"Familiar":reviewed(w)?"Needs review":"Learning"}</span></td>
      <td>${escapeHtml(w.createdAt?new Date(w.createdAt).toLocaleDateString():"—")}</td>
      <td><div class="row-actions"><button class="small-action" data-edit="${escapeHtml(w.id)}" aria-label="Edit ${escapeHtml(w.word)}">Edit</button><button class="small-action" data-delete="${escapeHtml(w.id)}" aria-label="Delete ${escapeHtml(w.word)}">×</button></div></td>
    </tr>`).join("");
    $("empty-state").classList.toggle("show",filtered.length===0);
    $("empty-state").querySelector("h3").textContent=words.length===0?"Your word bank starts here":"No matching words";
    $("empty-state").querySelector("p").textContent=words.length===0?"Add a word, paste a list, or import a CSV / TSV file.":"Try another search or change the filter.";
    $("empty-state").querySelector("#empty-add-btn").classList.toggle("hidden",words.length>0);
    $("table-count").textContent=`${filtered.length} ${filtered.length===1?"word":"words"}`;
    $("word-subtitle").textContent=words.length?`${words.length} entries in your collection.`:"Your collection, in one place.";
  }
  function renderReview(){
    const list=words.filter(reviewed);
    $("review-table-body").innerHTML=list.map(w=>`<tr><td><div class="word-main">${escapeHtml(w.word)}</div></td><td><div class="definition-cell">${escapeHtml(meaning(w))}</div></td><td><span class="status-pill review">${(w.spellingMistakes||0)>0?`Missed spelling ${w.spellingMistakes}×`:"Marked for review"}</span></td><td><div class="row-actions"><button class="small-action" data-known="${escapeHtml(w.id)}">Mark familiar</button><button class="small-action" data-edit="${escapeHtml(w.id)}">Edit</button></div></td></tr>`).join("");
    $("review-empty").classList.toggle("show",list.length===0);
  }
  function showView(view){
    currentView=view;document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active",el.id===`view-${view}`));
    document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
    const names={library:"Vocabulary library",flashcards:"Flashcards",spelling:"Spelling practice",quiz:"Multiple choice",review:"Review mistakes"};
    $("page-breadcrumb").textContent=names[view]||"Workspace";
    if(view==="flashcards")startFlashcards(false);
    if(view==="spelling"&&!spellSet.length)startSpelling(false);
    if(view==="quiz"&&!quizSet.length)startQuiz(false);
    if(view==="review")renderReview();
  }
  function openWordDialog(word=null){
    $("word-form").reset();$("word-id").value=word?.id||"";
    $("word-dialog-title").textContent=word?"Edit word":"Add a word";
    $("word-text").value=word?.word||"";$("word-definition").value=word?.definition||"";$("word-translation").value=word?.translation||"";
    $("word-example").value=word?.example||"";$("word-tags").value=(word?.tags||[]).join(", ");$("word-notes").value=word?.notes||"";
    $("word-dialog").showModal();setTimeout(()=>$("word-text").focus(),50);
  }
  async function submitWord(event){
    event.preventDefault();
    const id=$("word-id").value||makeId(), old=words.find(w=>w.id===id);
    const translation = clean($("word-translation").value);
const definition = clean($("word-definition").value);

const word = {
  ...(old || {}),
  id,
  word: normalize($("word-text").value),
  meaning: translation || definition,
  translation,
  definition,
  example: clean($("word-example").value),
  tags: clean($("word-tags").value)
    .split(",")
    .map(clean)
    .filter(Boolean),
  notes: clean($("word-notes").value),
  status: old?.status || "learning",
  createdAt: old?.createdAt || now(),
  updatedAt: now(),
  spellingAttempts: old?.spellingAttempts || 0,
  spellingCorrect: old?.spellingCorrect || 0,
  spellingMistakes: old?.spellingMistakes || 0
};
    await putWord(word);$("word-dialog").close();await reloadWords();showToast(old?"Word updated.":"Word saved automatically.");
  }
  function parseBulkLine(line){
    const delimiter=line.includes("\t")?"\t":"|";
    const parts=line.split(delimiter).map(clean);
    if(parts.length<2||!parts[0]||!parts[1])return null;
    return {id:makeId(),word:normalize(parts[0]),definition:parts[1],translation:parts[2]||"",example:parts[3]||"",tags:[],notes:"",status:"learning",createdAt:now(),updatedAt:now(),spellingAttempts:0,spellingCorrect:0,spellingMistakes:0};
  }
  function updateBulkPreview(){const lines=$("bulk-text").value.split(/\r?\n/).map(clean).filter(Boolean);$("bulk-preview").textContent=`${lines.filter(line=>parseBulkLine(line)).length} entries detected`;}
  async function importBulk(event){
    event.preventDefault();const entries=$("bulk-text").value.split(/\r?\n/).map(clean).filter(Boolean).map(parseBulkLine).filter(Boolean);
    if(!entries.length){showToast("No valid entries found. Use word | definition | translation.",true);return;}
    const existing=new Set(words.map(w=>w.word.toLocaleLowerCase()));const unique=entries.filter(w=>!existing.has(w.word.toLocaleLowerCase()));
    try{const tx=db.transaction(STORE,"readwrite"),store=tx.objectStore(STORE);unique.forEach(w=>store.put(w));await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});$("bulk-dialog").close();$("bulk-text").value="";await reloadWords();showToast(`Imported ${unique.length} words${entries.length!==unique.length?`; skipped ${entries.length-unique.length} duplicate(s)`:""}.`);}catch(e){showToast("Import failed. Check available browser storage.",true);}
  }
  function parseDelimited(text,delimiter){
    const rows=[];let row=[],cell="",quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i],next=text[i+1];if(c==='"'&&quoted&&next==='"'){cell+='"';i++;}else if(c==='"'){quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(cell);cell="";}else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&next==="\n")i++;row.push(cell);if(row.some(v=>clean(v)))rows.push(row);row=[];cell="";}else cell+=c;}
    row.push(cell);if(row.some(v=>clean(v)))rows.push(row);return rows;
  }
  async function importDelimited(file){
    try{
      const text=await file.text();const delimiter=file.name.toLowerCase().endsWith(".tsv")?"\t":(text.split(/\r?\n/,1)[0].includes("\t")?"\t":",");
      const rows=parseDelimited(text.replace(/^\uFEFF/,""),delimiter);
      if(!rows.length){showToast("This file has no entries.",true);return;}
      let start=0;const first=rows[0].map(v=>clean(v).toLowerCase());
      if(first.some(v=>["word","term","vocabulary"].includes(v))&&first.some(v=>["definition","meaning","translation"].includes(v)))start=1;
      const existing=new Set(words.map(w=>w.word.toLocaleLowerCase()));const entries=[];
      for(const row of rows.slice(start)){const word=clean(row[0]),definition=clean(row[1]);if(!word||!definition||existing.has(word.toLocaleLowerCase()))continue;existing.add(word.toLocaleLowerCase());entries.push({id:makeId(),word:normalize(word),definition,translation:clean(row[2]),example:clean(row[3]),tags:clean(row[4]).split(";").map(clean).filter(Boolean),notes:clean(row[5]),status:"learning",createdAt:now(),updatedAt:now(),spellingAttempts:0,spellingCorrect:0,spellingMistakes:0});}
      if(!entries.length){showToast("No new valid words found. Expected columns: word, definition, translation, example, tags, notes.",true);return;}
      const tx=db.transaction(STORE,"readwrite");entries.forEach(w=>tx.objectStore(STORE).put(w));await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});await reloadWords();showToast(`Imported ${entries.length} words from ${file.name}.`);
    }catch(e){console.error(e);showToast("Could not import this file.",true);}
    $("csv-import").value="";
  }
  function download(name,content,type="application/json"){
    const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportBackup(){const backup={app:"LexiLab",schemaVersion:1,exportedAt:now(),words};download(`lexilab-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backup,null,2));showToast("Backup exported. Keep the file somewhere safe.");}
  async function importBackup(file){
    try{const data=JSON.parse(await file.text());const incoming=Array.isArray(data)?data:data.words;if(!Array.isArray(incoming))throw new Error("No word list found");
      const normalized=incoming.filter(w=>w&&typeof w.word==="string"&&clean(w.word)&&typeof (w.definition||w.translation)==="string").map(w=>({...w,id:clean(w.id)||makeId(),word:normalize(w.word),definition:clean(w.definition),translation:clean(w.translation),example:clean(w.example),tags:Array.isArray(w.tags)?w.tags:[],status:["known","review","learning"].includes(w.status)?w.status:"learning",createdAt:w.createdAt||now(),updatedAt:now(),spellingAttempts:Number(w.spellingAttempts)||0,spellingCorrect:Number(w.spellingCorrect)||0,spellingMistakes:Number(w.spellingMistakes)||0}));
      if(!normalized.length)throw new Error("No valid words in backup");
      const replace=confirm(`Import ${normalized.length} words?\n\nOK = merge into your current library (matching IDs are updated).\nCancel = do nothing.`);
      if(!replace)return;
      const tx=db.transaction(STORE,"readwrite");normalized.forEach(w=>tx.objectStore(STORE).put(w));await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});await reloadWords();showToast(`Restored ${normalized.length} words from backup.`);
    }catch(e){console.error(e);showToast("Backup could not be read. Please choose a LexiLab JSON export.",true);}
    $("json-import").value="";
  }
  function startFlashcards(shuffleIt=true){
    flashSet=shuffleIt?shuffle(words):[...words];flashIndex=0;flashRevealed=false;flashSession={count:0,known:0};renderFlash();
  }
  function renderFlash(){
    const w=flashSet[flashIndex];$("flash-counter").textContent=flashSet.length?`${flashIndex+1} / ${flashSet.length}`:"0 / 0";$("flash-progress").textContent=flashSet.length?"Take your time":"Ready when you are";
    $("flash-session-count").textContent=flashSession.count;$("flash-session-known").textContent=flashSession.known;
    $("flashcard").disabled=!w;
    if(!w){$("flash-label").textContent="WORD";$("flash-prompt").textContent="Add words to begin";$("flash-hint").textContent="Your library is empty";$("flash-answer").textContent="Your answer appears here";$("flash-answer-note").textContent="No timer. Take your time.";return;}
    const defFirst=$("flash-direction").value==="definition";
    $("flash-label").textContent=defFirst?"DEFINITION":"WORD";$("flash-prompt").textContent=defFirst?meaning(w):w.word;
    $("flash-hint").textContent=flashRevealed?"Answer revealed":"Click to reveal the answer";
    $("flash-answer").textContent=defFirst?w.word:meaning(w);$("flash-answer").classList.toggle("answer-hidden",!flashRevealed);
    $("flash-answer-note").textContent=w.example?`Example: ${w.example}`:(w.notes||"No timer. Take your time.");
    $("flash-reveal").textContent=flashRevealed?"Answer revealed":"Reveal answer";
  }
  async function rateFlash(rating){const w=flashSet[flashIndex];if(!w)return;if(!flashRevealed){flashRevealed=true;renderFlash();return;}w.status=rating==="known"?"known":"review";w.lastReviewedAt=now();await putWord(w);flashSession.count++;if(rating==="known")flashSession.known++;await reloadWords();if(flashIndex<flashSet.length-1)flashIndex++;flashRevealed=false;renderFlash();}
  function eligibleSpelling(){return words.filter(w=>clean(w.definition||w.translation));}
  function startSpelling(shuffleIt=true,onlyReview=false){spellSet=shuffleIt?shuffle(onlyReview?words.filter(reviewed):eligibleSpelling()):(onlyReview?words.filter(reviewed):eligibleSpelling());spellSet=spellSet.filter(w=>clean(w.definition||w.translation));spellIndex=0;spellChecked=false;spellSession={attempts:0,correct:0};renderSpelling();}
  function renderSpelling(){
    const w=spellSet[spellIndex];$("spell-counter").textContent=spellSet.length?`Question ${spellIndex+1} of ${spellSet.length}`:"Question 0 of 0";
    $("spell-definition").textContent=w?meaning(w):"Add words with definitions to start practicing.";
    $("spell-note").textContent=w?(w.notes||""): "Words without definitions are not included.";
    $("spell-input").disabled=!w||spellChecked;$("spell-input").value="";$("spell-input").placeholder=w?"Type the word…":"No words available";$("spell-submit").disabled=!w||spellChecked;
    $("spell-next").classList.toggle("hidden",!spellChecked);$("spell-submit").classList.toggle("hidden",spellChecked);$("spell-skip").disabled=!w;
    $("spell-feedback").textContent="";$("spell-feedback").className="feedback";
    $("spell-session").textContent=spellSession.attempts?`${spellSession.correct} correct out of ${spellSession.attempts} attempts`:"No answers submitted yet";
    if(w&&!spellChecked)setTimeout(()=>$("spell-input").focus(),20);
  }
  async function submitSpelling(event){
    event.preventDefault();const w=spellSet[spellIndex];if(!w||spellChecked)return;
    const answer=normalize($("spell-input").value),target=normalize(w.word);if(!answer){$("spell-input").focus();return;}
    const strict=$("strict-case").checked;const correct=strict?answer===target:answer.toLocaleLowerCase()===target.toLocaleLowerCase();
    spellChecked=true;spellSession.attempts++;w.spellingAttempts=(w.spellingAttempts||0)+1;
    const feedback=$("spell-feedback");
    if(correct){spellSession.correct++;w.spellingCorrect=(w.spellingCorrect||0)+1;feedback.textContent="Correct. Well spelled.";feedback.classList.add("correct");}
    else{w.spellingMistakes=(w.spellingMistakes||0)+1;w.status="review";feedback.textContent=`Not quite. Correct spelling: ${w.word}`;feedback.classList.add("incorrect");}
    w.lastSpellingAt=now();await putWord(w);await reloadWords();
    $("spell-input").disabled=true;$("spell-submit").classList.add("hidden");$("spell-next").classList.remove("hidden");$("spell-session").textContent=`${spellSession.correct} correct out of ${spellSession.attempts} attempts`;$("spell-next").focus();
  }
  function nextSpelling(){if(spellIndex<spellSet.length-1){spellIndex++;spellChecked=false;renderSpelling();}else{const rate=spellSession.attempts?Math.round(spellSession.correct/spellSession.attempts*100):0;$("spell-definition").textContent="Practice set complete";$("spell-note").textContent=`You answered ${spellSession.correct} of ${spellSession.attempts} attempted questions correctly (${rate}%).`;spellSet=[];$("spell-input").disabled=true;$("spell-submit").disabled=true;$("spell-next").classList.add("hidden");$("spell-submit").classList.remove("hidden");$("spell-submit").disabled=true;$("spell-counter").textContent="Complete";}}
  function startQuiz(shuffleIt=true){
    const eligible=words.filter(w=>clean(w.definition||w.translation));quizSet=shuffleIt?shuffle(eligible):eligible;quizIndex=0;quizAnswered=false;quizSession={attempts:0,correct:0};renderQuiz();
  }
  function renderQuiz(){
    const w=quizSet[quizIndex];$("quiz-counter").textContent=quizSet.length?`Question ${quizIndex+1} of ${quizSet.length}`:"Question 0 of 0";
    $("quiz-word").textContent=w?w.word:"Add words with definitions to begin.";
    $("quiz-options").innerHTML="";$("quiz-feedback").textContent="";$("quiz-feedback").className="feedback";$("quiz-next").classList.add("hidden");
    if(!w){$("quiz-session").textContent="Add at least one word with a definition.";return;}
    const distractors=shuffle(words.filter(x=>x.id!==w.id&&clean(x.definition||x.translation))).slice(0,3);
    const options=shuffle([w,...distractors]);
    if(options.length===1){$("quiz-options").innerHTML='<p class="practice-note">Add at least two more words with definitions to make multiple-choice questions more useful.</p>';return;}
    $("quiz-options").innerHTML=options.map((opt,i)=>`<button class="quiz-option" data-answer="${escapeHtml(opt.id)}"><span class="option-letter">${String.fromCharCode(65+i)}</span><span>${escapeHtml(meaning(opt))}</span></button>`).join("");
    $("quiz-session").textContent=quizSession.attempts?`${quizSession.correct} correct out of ${quizSession.attempts} answered`:"Choose the best definition.";
  }
  async function answerQuiz(id,button){
    if(quizAnswered)return;const w=quizSet[quizIndex];if(!w)return;quizAnswered=true;quizSession.attempts++;
    const correct=id===w.id;if(correct)quizSession.correct++;
    document.querySelectorAll(".quiz-option").forEach(el=>{el.disabled=true;if(el.dataset.answer===w.id)el.classList.add("correct");});
    if(!correct){button.classList.add("incorrect");w.status="review";w.quizMistakes=(w.quizMistakes||0)+1;await putWord(w);}
    $("quiz-feedback").textContent=correct?"Correct.":`Not quite. The definition is: ${meaning(w)}`;$("quiz-feedback").classList.add(correct?"correct":"incorrect");
    $("quiz-next").classList.remove("hidden");$("quiz-session").textContent=`${quizSession.correct} correct out of ${quizSession.attempts} answered`;await reloadWords();
  }
  function nextQuiz(){if(quizIndex<quizSet.length-1){quizIndex++;quizAnswered=false;renderQuiz();}else{$("quiz-word").textContent="Practice set complete";$("quiz-options").innerHTML="";$("quiz-feedback").textContent=`You answered ${quizSession.correct} of ${quizSession.attempts} questions correctly.`;$("quiz-next").classList.add("hidden");$("quiz-counter").textContent="Complete";}}
  function bindEvents(){
    document.querySelectorAll(".nav-item").forEach(el=>el.addEventListener("click",()=>showView(el.dataset.view)));
    $("add-word-btn").addEventListener("click",()=>openWordDialog());$("empty-add-btn").addEventListener("click",()=>openWordDialog());
    $("word-form").addEventListener("submit",submitWord);$("bulk-btn").addEventListener("click",()=>{$("bulk-dialog").showModal();updateBulkPreview();});$("bulk-form").addEventListener("submit",importBulk);$("bulk-text").addEventListener("input",updateBulkPreview);
    document.querySelectorAll("[data-close]").forEach(el=>el.addEventListener("click",()=>$(el.dataset.close).close()));
    $("word-table-body").addEventListener("click",async e=>{const edit=e.target.closest("[data-edit]"),del=e.target.closest("[data-delete]");if(edit){const w=words.find(x=>x.id===edit.dataset.edit);if(w)openWordDialog(w);}if(del){const w=words.find(x=>x.id===del.dataset.delete);if(w&&confirm(`Delete "${w.word}" from your library? This cannot be undone unless you have a backup.`)){await deleteWord(w.id);await reloadWords();showToast("Word deleted.");}}});
    $("review-table-body").addEventListener("click",async e=>{const known=e.target.closest("[data-known]"),edit=e.target.closest("[data-edit]");if(known){const w=words.find(x=>x.id===known.dataset.known);if(w){w.status="known";await putWord(w);await reloadWords();showToast("Marked as familiar.");}}if(edit){const w=words.find(x=>x.id===edit.dataset.edit);if(w)openWordDialog(w);}});
    $("search-input").addEventListener("input",renderLibrary);$("filter-select").addEventListener("change",renderLibrary);
    $("export-btn").addEventListener("click",exportBackup);$("json-import").addEventListener("change",e=>{if(e.target.files[0])importBackup(e.target.files[0]);});$("csv-import").addEventListener("change",e=>{if(e.target.files[0])importDelimited(e.target.files[0]);});
    $("flashcard").addEventListener("click",()=>{flashRevealed=!flashRevealed;renderFlash();});$("flash-reveal").addEventListener("click",()=>{flashRevealed=true;renderFlash();});
    $("flash-next").addEventListener("click",()=>{if(flashIndex<flashSet.length-1)flashIndex++;flashRevealed=false;renderFlash();});$("flash-prev").addEventListener("click",()=>{if(flashIndex>0)flashIndex--;flashRevealed=false;renderFlash();});
    $("shuffle-flash").addEventListener("click",()=>startFlashcards(true));$("flash-reset").addEventListener("click",()=>startFlashcards(false));$("flash-direction").addEventListener("change",renderFlash);
    document.querySelectorAll("[data-rating]").forEach(el=>el.addEventListener("click",()=>rateFlash(el.dataset.rating)));
    $("spelling-form").addEventListener("submit",submitSpelling);$("spell-next").addEventListener("click",nextSpelling);$("spell-skip").addEventListener("click",()=>{if(spellIndex<spellSet.length-1){spellIndex++;spellChecked=false;renderSpelling();}else{spellSet=[];renderSpelling();}});
    $("spelling-restart").addEventListener("click",()=>startSpelling(true));$("strict-case").addEventListener("change",()=>{});
    $("quiz-restart").addEventListener("click",()=>startQuiz(true));$("quiz-next").addEventListener("click",nextQuiz);
    $("quiz-options").addEventListener("click",e=>{const button=e.target.closest("[data-answer]");if(button)answerQuiz(button.dataset.answer,button);});
    $("review-spell-btn").addEventListener("click",()=>{if(!words.some(reviewed)){showToast("There are no words to review yet.");return;}startSpelling(true,true);showView("spelling");});
    window.addEventListener("beforeunload",()=>{if(db)db.close();});
  }
  async function init(){
    bindEvents();
    try{db=await openDatabase();await reloadWords();startFlashcards(false);startSpelling(false);startQuiz(false);
      if(navigator.storage?.persist){navigator.storage.persist().then(granted=>{if(granted)console.info("LexiLab storage persistence granted.");}).catch(()=>{});}
      if(navigator.storage?.estimate){navigator.storage.estimate().then(info=>{if(info.quota&&info.usage/info.quota>.8)showToast("Browser storage is getting full. Export a backup soon.",true);}).catch(()=>{});}
    }catch(e){console.error(e);showToast("Could not open local storage. Try a modern browser with site storage enabled.",true);}
  }
  init();
})();
