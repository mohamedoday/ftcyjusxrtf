'use strict';
(()=>{
 // These are public guide pages. Count them in the existing "about" analytics
 // section, using the same visitor cookie as the app and no personal payload.
 let recorded=false;
 function visit(){if(recorded||document.visibilityState!=='visible')return;recorded=true;fetch('/api/visit',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:'about'}),keepalive:true}).catch(()=>{})}
 document.addEventListener('visibilitychange',visit);visit();
})();
