
import { Client } from 'node-osc';

const client = new Client('127.0.0.1', 3333);
// client.send('/stt', 200, () => {
//   client.close();
// });

import Speech2Text from '../lib/Speech2Text';


const onGetTextProgress = (mes)=>{
  // console.log(`onGetTextProgress : ${mes}`);
  client.send('/stt', mes, () => {
    // client.close();
  });
  resetTimer();
};

const onGetText = (mes)=>{
  // console.log(`onGetText : ${mes}`);
  client.send('/stt', mes, () => {
    // client.close();
  });
  resetTimer();
};

const onCompleteTranslate = (mes)=>{
  // console.log(`onCompleteTranslate : ${mes}`);
  client.send('/stt/en', mes, () => {
    // client.close();
  });
  resetTimer();
};

let timer;

const setTimer = ()=>{
  timer = setInterval(()=>{
    // onGetText('');
    // onCompleteTranslate('');
  },3500);
};
const resetTimer = ()=>{
  clearInterval(timer);
  timer = null;
  setTimer();
};
setTimer();


process.on("exit", () => {
  console.log("Exitting...");
  client.close();
})
process.on("SIGINT",  () => {
  process.exit(0);
});


const speech2Text = new Speech2Text();
speech2Text.onGetTextProgress = onGetTextProgress;
speech2Text.onGetText = onGetText;
speech2Text.onCompleteTranslate = onCompleteTranslate;