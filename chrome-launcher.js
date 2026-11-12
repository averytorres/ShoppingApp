const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');

function profiles(){
  if(process.platform!=='win32')return [];
  try{
    const root=path.join(process.env.LOCALAPPDATA,'Google/Chrome/User Data');
    const info=JSON.parse(fs.readFileSync(path.join(root,'Local State'),'utf8')).profile.info_cache;
    return Object.entries(info).filter(([directory])=>/^(Default|Profile \d+)$/.test(directory)).flatMap(([directory,entry])=>{
      let settings={};
      for(const file of ['Preferences','Secure Preferences'])try{Object.assign(settings,JSON.parse(fs.readFileSync(path.join(root,directory,file),'utf8')).extensions?.settings||{});}catch{}
      const installed=Object.values(settings).some(extension=>extension.path&&path.resolve(extension.path).toLowerCase()===path.join(__dirname,'walmart-extension').toLowerCase());
      return installed?[{directory,name:String(entry.name||directory)}]:[];
    });
  }catch{return [];}
}
function launch(directory){
  if(!profiles().some(profile=>profile.directory===directory))throw Error('This Chrome profile no longer has the grocery extension installed. Check browser setup.');
  const executable=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(root=>path.join(root,'Google/Chrome/Application/chrome.exe')).find(file=>fs.existsSync(file));
  if(!executable)throw Error('Google Chrome could not be found on this PC.');
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const command=`$ErrorActionPreference='Stop'; Start-Process -FilePath ${quote(executable)} -ArgumentList @(${['--profile-directory="'+directory+'"','--no-startup-window'].map(quote).join(',')}) -WindowStyle Hidden`;
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,stdio:'ignore'});
    const timeout=setTimeout(()=>{child.kill();reject(Error('Windows did not finish launching Chrome. Check the selected profile.'));},15000);
    child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(Error('Windows could not start Chrome.'));});
  });
}
module.exports={profiles,launch};
