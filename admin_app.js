import {createSecurityPanel} from '/admin-security.mjs';
import {createTrialEditor} from '/admin-trial.mjs';
import {createSupportPanel} from '/admin-support.mjs';
import {createSettingsEditor} from '/admin-settings.mjs';
import {renderArticle} from '/article-markdown.mjs';
import {adminMaterialProviders} from '/admin-materials.mjs';
'use strict';
const $=id=>document.getElementById(id);
const tabs=[...document.querySelectorAll('[data-tab]')];
const pageNames={home:'Главная',account:'Личный кабинет',work:'Работа промптов',assortment:'Ассортимент',about:'Что это такое'};
const number=new Intl.NumberFormat('ru-RU');
let csrf='',setup=false,config=null,pageContent=null,settingsEditor=null,trialEditor=null,securityPanel=null,supportPanel=null;
let modelsDirty=false,contentDirty=false,saving=false,uploads=0,accountsPage=1,accountsVersion=0;
const initialKey=new URLSearchParams(location.hash.slice(1)).get('setup');
if(initialKey){$('setup-key').value=initialKey;history.replaceState(null,'','/admin')}

function message(id,text,error=false){
 const element=$(id);
 element.textContent=text;
 element.classList.toggle('error',error);
}
function showAuth(){
 securityPanel?.clear();
 supportPanel?.clear();
 $('auth').hidden=false;$('editor').hidden=true;$('logout').hidden=true;
}
async function api(url,method='GET',body,passive=false){
 const requestCsrf=csrf;
 const response=await fetch(url,{
  method,cache:'no-store',headers:{...(passive?{'X-Jailbrok-Passive':'1'}:{}),...(method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf})},
  body:body===undefined?undefined:JSON.stringify(body)
 });
 const data=await response.json();
 if(!response.ok){
  if(response.status===401&&csrf===requestCsrf)showAuth();
  throw Object.assign(Error(data.error||'Не удалось выполнить запрос'),{status:response.status,data});
 }
 return data;
}
function updateDraft(){
 const dirty=modelsDirty||contentDirty||settingsEditor?.dirty()||trialEditor?.dirty()||supportPanel?.dirty();
 $('draft-status').textContent=dirty?'Есть несохранённые изменения':'Все изменения сохранены';
 $('draft-status').classList.toggle('is-dirty',dirty);
 $('models-save-state').textContent=modelsDirty?'Есть изменения в материалах':'Материалы сохранены';
}
function markModels(){
 modelsDirty=true;updateDraft();
 for(const list of document.querySelectorAll('.model-items')){
  updateModelCount(list);
 }
 filterModels();
}
function updateModelCount(list){
 const fromBot=[...list.children].filter(item=>item.dataset.managedBy==='bot').length;
 const own=list.children.length-fromBot;
 list.closest('fieldset').querySelector('.provider-count').textContent=fromBot
  ?fromBot+' из бота'+(list.dataset.siteEditable==='true'?' · '+own+' / 20 на сайте':'')
  :own+' / 20 моделей';
}
function collectModel(item){
 return {id:item.dataset.id,...Object.fromEntries([...item.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value]))};
}
function previewModel(item,provider){
 const model=collectModel(item);
 $('preview-title').textContent=model.name||'Без названия';
 $('preview-provider').textContent=provider;
 $('preview-file').textContent=model.fileName||'prompt.txt';
 $('preview-content').textContent=model.content||'Текст промпта пока не добавлен.';
 $('preview-instructions').textContent=model.instructions||'Инструкция пока не добавлена.';
 const link=$('preview-link');
 link.hidden=true;link.removeAttribute('href');
 try{
  const url=new URL(model.url);
  if(url.protocol==='https:'&&!url.username&&!url.password){link.href=url.href;link.hidden=false}
 }catch{}
 $('model-preview').showModal();
}
function modelRow(model,list){
 const item=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');
 item.className='model-editor';item.dataset.id=model.id;item.dataset.managedBy=model.managedBy||'site';
 summary.textContent=model.name+(model.managedBy==='bot'?' · Из бота':'');body.className='model-body';
 item.append(summary,body);
 const field=(title,key,value,max,multiline=false)=>{
  const label=document.createElement('label'),input=document.createElement(multiline?'textarea':'input');
  label.textContent=title;input.value=value||'';input.dataset.field=key;input.maxLength=max;
  input.setAttribute('aria-label',title+' — '+model.name);input.readOnly=model.managedBy==='bot';
  if(key==='url')input.type='url';
  label.append(input);body.append(label);
  input.addEventListener('input',()=>{
   if(key==='name')summary.textContent=input.value||'Без названия';
   markModels();
  });
  return input;
 };
 field('Название модели','name',model.name,80);
 const filename=field('Имя TXT-файла','fileName',model.fileName,100);
 const content=field('Промпт','content',model.content,100000,true);
 field('Инструкция','instructions',model.instructions,20000,true);
 field('Ссылка HTTPS','url',model.url,2048);
 const uploadLabel=document.createElement('label'),upload=document.createElement('input'),note=document.createElement('p');
 uploadLabel.textContent='Загрузить TXT-файл';upload.type='file';upload.accept='.txt,text/plain';
 upload.setAttribute('aria-label','Загрузить TXT — '+model.name);uploadLabel.append(upload);
 note.className='upload-message';body.append(uploadLabel,note);
 if(model.managedBy==='bot'){uploadLabel.hidden=true;upload.disabled=true;note.textContent='Синхронизировано с ботом. Файл, название и инструкцию редактируй в Telegram.'}
 upload.addEventListener('change',async()=>{
  const file=upload.files[0];if(!file)return;
  upload.disabled=true;uploads++;updateActions();
  try{
   if(!/\.txt$/i.test(file.name))throw Error('Выбери файл с расширением .txt');
   if(file.name.length>100)throw Error('Имя файла должно быть не длиннее 100 символов');
   if(file.size>262144)throw Error('Размер файла должен быть не больше 256 КБ');
   const text=await file.text();
   if(text.length>100000)throw Error('Промпт должен быть не длиннее 100 000 символов');
   content.value=text;filename.value=file.name;markModels();
   note.textContent='Файл загружен в черновик. Сохрани материалы для публикации.';
  }catch(error){note.textContent=error.message}
  finally{upload.value='';upload.disabled=false;uploads--;updateActions()}
 });
 const actions=document.createElement('div');actions.className='model-actions';
 const action=(label,handler,danger=false)=>{
  const button=document.createElement('button');button.type='button';button.className='secondary'+(danger?' danger':'');button.textContent=label;
  if(label==='↑')button.setAttribute('aria-label','Поднять модель');
  if(label==='↓')button.setAttribute('aria-label','Опустить модель');
  button.addEventListener('click',handler);actions.append(button);
 };
 action('Предпросмотр',()=>previewModel(item,list.dataset.provider));
 if(model.managedBy!=='bot'){
 action('↑',()=>{if(item.previousElementSibling&&item.previousElementSibling.dataset.managedBy!=='bot'){list.insertBefore(item,item.previousElementSibling);markModels()}});
 action('↓',()=>{if(item.nextElementSibling&&item.nextElementSibling.dataset.managedBy!=='bot'){list.insertBefore(item.nextElementSibling,item);markModels()}});
 action('Удалить',()=>{
  if(confirm('Удалить модель «'+(item.querySelector('[data-field="name"]').value||'Без названия')+'»? Изменение применится после сохранения.')){
   item.remove();markModels();
  }
 },true);
 }
 body.append(actions);list.append(item);
 return item;
}
function filterModels(){
 const search=$('model-search').value.trim().toLowerCase(),provider=$('provider-filter').value;
 let shown=0;
 for(const list of document.querySelectorAll('.model-items')){
  let matches=0;
  for(const item of list.children){
   const name=item.querySelector('[data-field="name"]').value.toLowerCase();
   item.hidden=Boolean(search&&!name.includes(search));
   if(!item.hidden)matches++;
  }
  const hidden=(provider&&provider!==list.dataset.provider)||(search&&!matches);
  list.closest('fieldset').hidden=Boolean(hidden);
  if(!hidden)shown++;
 }
 $('models-empty').hidden=shown>0;
}
function renderModels(preserve=false){
 const search=preserve?$('model-search').value:'',selected=preserve?$('provider-filter').value:'';
 const openIds=new Set(preserve?[...document.querySelectorAll('.model-editor[open]')].map(item=>item.dataset.id):[]);
 $('model-fields').replaceChildren();
 $('provider-filter').replaceChildren(new Option('Все нейросети',''));
 for(const provider of adminMaterialProviders(config)){
  $('provider-filter').add(new Option(provider.name,provider.name));
  const box=document.createElement('fieldset'),legend=document.createElement('legend'),toolbar=document.createElement('div');
  const list=document.createElement('div'),count=document.createElement('span'),add=document.createElement('button');
  box.className='provider-editor';legend.textContent=provider.name;
  toolbar.className='provider-toolbar';count.className='provider-count';
  list.className='model-items';list.dataset.provider=provider.name;list.dataset.siteEditable=String(provider.editable);
  add.type='button';add.className='secondary';add.textContent='+ Добавить';add.hidden=!provider.editable;
  add.addEventListener('click',()=>{
   if([...list.children].filter(item=>item.dataset.managedBy!=='bot').length>=20){message('save-message','У одной нейросети может быть до 20 моделей.',true);return}
   const names=new Set([...list.children].map(item=>item.querySelector('[data-field="name"]').value.trim()));
   let name='Новая модель',suffix=2;
   while(names.has(name))name='Новая модель '+suffix++;
   const item=modelRow({id:crypto.randomUUID(),name,fileName:'prompt.txt'},list);
   $('model-search').value='';markModels();item.open=true;item.querySelector('input').focus();
  });
  toolbar.append(count,add);box.append(legend,toolbar,list);$('model-fields').append(box);
  provider.models.forEach(model=>modelRow(model,list));
  updateModelCount(list);
 }
 $('model-search').value=search;$('provider-filter').value=[...$('provider-filter').options].some(option=>option.value===selected)?selected:'';
 for(const item of document.querySelectorAll('.model-editor'))item.open=openIds.has(item.dataset.id);filterModels();
}
function renderContent(){
 $('work-banner-input').value=pageContent.workBannerText||'';
 $('offer-banner-input').value=pageContent.offerBannerText||'';
 previewContent();
}
function previewContent(){
 for(const [input,preview,counter,max] of [
  ['work-banner-input','work-preview','work-counter',12000],['offer-banner-input','offer-preview','offer-counter',500]
 ]){
  const value=$(input).value||'Текст баннера пока не добавлен.';
  if(input==='work-banner-input')renderArticle($(preview),value);else $(preview).textContent=value;
  $(counter).textContent=number.format($(input).value.length)+' / '+number.format(max);
 }
}
async function reloadModels(){
 if(saving||uploads)return;
 if(modelsDirty&&!confirm('Загрузить опубликованный список? Несохранённые изменения в материалах будут потеряны.'))return;
 try{
  config=await api('/api/admin/models');renderModels();modelsDirty=false;updateDraft();
  message('save-message','Загружена опубликованная версия.');
 }catch(error){message('save-message',error.message,true)}
}
function statRow(label,value){
 const row=document.createElement('div'),name=document.createElement('span'),count=document.createElement('strong');
 row.className='stat-row';name.textContent=label;count.textContent=number.format(value);row.append(name,count);
 return row;
}
async function loadOverview(){
 $('overview-refresh').disabled=true;message('overview-message','');
 try{
  const results=await Promise.allSettled([api('/api/admin/overview'),api('/api/admin/stats')]);
  const [overview,stats]=results;
  if(overview.status==='fulfilled'){
   for(const [id,key]of [['summary-accounts','accounts'],['summary-telegram','telegramLinked'],['summary-models','models'],['summary-ready','withMaterials']]){
    $(id).textContent=number.format(overview.value[key]);
   }
  }
  if(stats.status==='fulfilled'){
   const data=stats.value,day=data.periods.find(period=>period.label==='24 часа');
   $('summary-visitors').textContent=number.format(day?.visitors||0);
   $('summary-views').textContent=number.format(data.pages.reduce((sum,page)=>sum+page.views,0));
   const difference=(day?.visitors||0)-data.previousDay;
   $('summary-trend').textContent=difference>0?'+'+number.format(difference)+' к предыдущим суткам':difference<0?number.format(difference)+' к предыдущим суткам':'На уровне предыдущих суток';
   $('stats-periods').replaceChildren(...(data.total?[statRow('Всего за время учёта',data.total.visitors),statRow('Всего просмотров',data.total.views)]:[]),...data.periods.map(period=>statRow(period.label,period.visitors)));
   $('stats-pages').replaceChildren(...data.pages.map(page=>statRow(pageNames[page.page]||page.page,page.views)));
   if(!data.pages.length)$('stats-pages').textContent='Просмотры появятся после посещения сайта.';
   $('stats-note').textContent=(data.total?.sinceMinute?'Общий учёт с '+new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow'}).format(new Date(data.total.sinceMinute*60000))+'. ':'')+'Гости считаются по браузерам, вошедшие пользователи — по аккаунтам.'+(data.legacy?' Старые визиты учтены по IP.':'');
  }else{
   $('summary-visitors').textContent='—';$('summary-views').textContent='—';
   $('summary-trend').textContent='Статистика временно недоступна';
   $('stats-periods').textContent='Не удалось загрузить посещаемость. Нажми «Обновить».';
   $('stats-pages').replaceChildren();$('stats-note').textContent='';
  }
  const errors=results.filter(result=>result.status==='rejected');
  if(errors.length)message('overview-message',errors.map(result=>result.reason.message).join(' '),true);
 }finally{$('overview-refresh').disabled=false}
}
async function loadAccounts(page=1){
 const request=++accountsVersion;accountsPage=page;
 message('accounts-message','Загружаем аккаунты…');$('accounts-prev').disabled=true;$('accounts-next').disabled=true;
 try{
  const data=await api('/api/admin/accounts?q='+encodeURIComponent($('account-search').value.trim())+'&page='+page);
  if(request!==accountsVersion)return;
  $('account-list').replaceChildren();
  const dates=new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'});
  for(const account of data.accounts){
   const card=document.createElement('article'),title=document.createElement('div'),name=document.createElement('strong'),copy=document.createElement('button'),fields=document.createElement('dl');
   card.className='account-card';title.className='account-title';name.textContent=account.name||'Без имени';
   copy.type='button';copy.className='secondary copy-id';copy.textContent='Копировать ID';
   copy.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(account.id);copy.textContent='Скопировано'}
    catch{message('accounts-message','Выдели ID в карточке и скопируй его вручную.',true)}
   });
   const field=(label,value,code=false)=>{
    const box=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
    dt.textContent=label;
    if(code){const text=document.createElement('code');text.textContent=value;dd.append(text)}else dd.textContent=value;
    box.append(dt,dd);fields.append(box);
   };
   field('ID сайта',account.id,true);
   field('Telegram ID',account.telegramId||'Не подключён',Boolean(account.telegramId));
   if(account.email)field('Email',account.email+(account.emailVerified?' · подтверждён':''));
   field('Регистрация · Москва',account.createdAt&&Number.isFinite(Date.parse(account.createdAt))?dates.format(new Date(account.createdAt)):'Дата не записана');
   title.append(name,copy);card.append(title,fields);$('account-list').append(card);
  }
  message('accounts-message',data.total?'Найдено аккаунтов — '+number.format(data.total):'По этому запросу аккаунтов нет.');
  const pages=Math.max(1,Math.ceil(data.total/data.pageSize));
  $('accounts-page').textContent=page+' / '+pages;
  $('accounts-prev').disabled=page<=1;$('accounts-next').disabled=page>=pages;
 }catch(error){if(request===accountsVersion)message('accounts-message',error.message,true)}
}
function selectTab(name,focus=false){
 if(!tabs.some(tab=>tab.dataset.tab===name))name='overview';
 for(const tab of tabs){
  const active=tab.dataset.tab===name;
  tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
  $('panel-'+tab.dataset.tab).hidden=!active;
  if(active&&focus)tab.focus();
 }
 if(location.hash!=='#'+name)history.replaceState(null,'','#'+name);
 if(name==='overview')loadOverview();
 if(name==='accounts')loadAccounts();
 if(name==='models')refreshSyncedModels();
 supportPanel?.setActive(name==='support');
}
async function openEditor(){
 const [models,content]=await Promise.all([api('/api/admin/models'),api('/api/admin/content')]);
 if(!modelsDirty){config=models;renderModels()}
 if(!contentDirty){pageContent=content;renderContent()}
 await settingsEditor.load();await securityPanel.load();
 $('auth').hidden=true;$('editor').hidden=false;$('logout').hidden=false;updateDraft();
 supportPanel.start();
 selectTab(location.hash.slice(1));
}
function savingState(form,value){
 saving=value;form.inert=value;
 updateActions();
}
function updateActions(){
 const blocked=saving||uploads>0;
 for(const id of ['save','content-save','logout','models-reload','site-save','site-reload','site-restore','site-preview','site-export','site-image-upload','trial-editor-open','trial-editor-save','trial-editor-reload','trial-editor-upload'])$(id).disabled=blocked;
}
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();$('login-button').disabled=true;message('auth-message','');
 try{
  const data=await api(setup?'/api/admin/setup':'/api/admin/login','POST',{password:$('admin-password').value,code:$('admin-code').value.trim(),token:$('setup-key').value.trim()});
  csrf=data.csrf;setup=false;$('admin-code').value='';
  $('admin-password').value='';$('setup-key').value='';$('setup-label').hidden=true;
  $('auth-title').textContent='Вход в админпанель';$('auth-description').textContent='Введи пароль, чтобы продолжить работу.';
  $('admin-password').minLength=1;$('admin-password').autocomplete='current-password';$('login-button').textContent='Войти';
  await openEditor();
 }catch(error){if(error.data?.mfaRequired)$('admin-code-label').hidden=false;message('auth-message',error.message,true)}
 finally{$('login-button').disabled=false}
});
$('models-form').addEventListener('submit',async event=>{
 event.preventDefault();if(saving||uploads)return;
 savingState(event.currentTarget,true);message('save-message','Сохраняем материалы…');
 try{
  const providers=[...document.querySelectorAll('.model-items')].filter(list=>list.dataset.siteEditable==='true').map(list=>({name:list.dataset.provider,models:[...list.children].filter(item=>item.dataset.managedBy!=='bot').map(collectModel)}));
  config=await api('/api/admin/models','PUT',{revision:config.revision,providers});
  modelsDirty=false;renderModels(true);updateDraft();message('save-message','Материалы опубликованы на сайте.');
 }catch(error){message('save-message',error.message,true)}
 finally{savingState($('models-form'),false)}
});
$('content-form').addEventListener('submit',async event=>{
 event.preventDefault();if(saving||uploads)return;
 savingState(event.currentTarget,true);message('content-message','Сохраняем баннеры…');
 try{
  pageContent=await api('/api/admin/content','PUT',{revision:pageContent.revision,workBannerText:$('work-banner-input').value,offerBannerText:$('offer-banner-input').value});
  contentDirty=false;updateDraft();message('content-message','Баннеры опубликованы. Открытая страница сайта получит изменения в течение 15 секунд.');
 }catch(error){message('content-message',error.message,true)}
 finally{savingState($('content-form'),false)}
});
for(const id of ['work-banner-input','offer-banner-input'])$(id).addEventListener('input',()=>{contentDirty=true;updateDraft();previewContent()});
$('model-search').addEventListener('input',filterModels);$('provider-filter').addEventListener('change',filterModels);
let modelsRefreshing=false;
async function refreshSyncedModels(){
 if(modelsRefreshing||document.hidden||!csrf||$('editor').hidden||$('panel-models').hidden||modelsDirty||saving||uploads)return;
 modelsRefreshing=true;const previous=config;
 try{
  const next=await api('/api/admin/models','GET',undefined,true);
  if(config!==previous||modelsDirty||saving||uploads||$('editor').hidden)return;
  if(next.revision!==config.revision||next.botRevision!==config.botRevision){config=next;renderModels(true);updateDraft()}
 }catch{}finally{modelsRefreshing=false}
}
window.addEventListener('focus',refreshSyncedModels);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSyncedModels()});
setInterval(refreshSyncedModels,15000);
$('models-reload').addEventListener('click',reloadModels);$('overview-refresh').addEventListener('click',loadOverview);
let searchTimer;
$('account-search').addEventListener('input',()=>{clearTimeout(searchTimer);accountsVersion++;searchTimer=setTimeout(()=>loadAccounts(),250)});
$('accounts-refresh').addEventListener('click',()=>loadAccounts(accountsPage));
$('accounts-prev').addEventListener('click',()=>loadAccounts(accountsPage-1));
$('accounts-next').addEventListener('click',()=>loadAccounts(accountsPage+1));
tabs.forEach((tab,index)=>{
 tab.addEventListener('click',()=>selectTab(tab.dataset.tab));
 tab.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  selectTab(tabs[next].dataset.tab,true);
 });
});
$('preview-close').addEventListener('click',()=>$('model-preview').close());
let backdrop=false;
function outside(event){
 const dialog=$('model-preview'),rect=dialog.getBoundingClientRect();
 return event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);
}
$('model-preview').addEventListener('pointerdown',event=>{backdrop=outside(event)});
$('model-preview').addEventListener('click',event=>{if(backdrop&&outside(event))$('model-preview').close();backdrop=false});
$('logout').addEventListener('click',async()=>{
 if(saving||uploads)return;
 if((modelsDirty||contentDirty||settingsEditor?.dirty()||trialEditor?.dirty()||supportPanel?.dirty())&&!confirm('Выйти и потерять несохранённые изменения?'))return;
 try{await api('/api/admin/logout','POST',{});modelsDirty=false;contentDirty=false;location.reload()}
 catch(error){message('overview-message',error.message,true);selectTab('overview')}
});
window.addEventListener('beforeunload',event=>{if(modelsDirty||contentDirty||settingsEditor?.dirty()||trialEditor?.dirty()||supportPanel?.dirty()||saving||uploads){event.preventDefault();event.returnValue=''}});
window.addEventListener('hashchange',()=>{if(!$('editor').hidden)selectTab(location.hash.slice(1))});
settingsEditor=createSettingsEditor({api,changed:updateDraft,busy:value=>{if(value===undefined)return saving||uploads>0;saving=value;updateActions()}});
trialEditor=createTrialEditor({api,changed:updateDraft,busy:value=>{if(value===undefined)return saving||uploads>0;saving=value;updateActions()}});
securityPanel=createSecurityPanel({api});
supportPanel=createSupportPanel({api,changed:updateDraft});
document.addEventListener('jailbrok:admin-csrf',event=>{csrf=event.detail});
(async()=>{
 try{const session=await api('/api/admin/session');csrf=session.csrf;await openEditor()}
 catch(error){
  setup=error.data?.setupRequired===true;$('admin-code-label').hidden=!error.data?.mfaRequired;
  if(setup){
   $('auth-title').textContent='Первый вход администратора';
   $('auth-description').textContent='Введи ключ из файла .data/setup-token на сервере и задай пароль длиной от 12 символов.';
   $('setup-label').hidden=Boolean(initialKey);$('admin-password').minLength=12;
   $('admin-password').autocomplete='new-password';$('login-button').textContent='Создать доступ';
  }else if(error.status!==401)message('auth-message','Не удалось загрузить панель. Обнови страницу.',true);
 }
})();
