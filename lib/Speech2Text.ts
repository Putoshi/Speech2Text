const speech = require('@google-cloud/speech');
const recorder = require('node-record-lpcm16');

import { URLSearchParams } from "url";
const chalk = require('chalk');
const {Writable} = require('stream');

const axios = require('axios');
const config = require('../config.json');
const deeplUrl = config.deepl.API_ENDPOINT;
const deeplAuthKey = config.deepl.AUTH_KEY;
const targetLang = 'EN-US';
const sourceLang = 'JA';
const sttConfig: {
  encoding:string,
  sampleRateHertz:number,
  languageCode:string,
  streamingLimit:number
} = {
  encoding:'LINEAR16',
  sampleRateHertz:16000,
  languageCode:'ja-JP',//'ja-JP','en-US'
  streamingLimit:290000
};

export default class Speech2Text {

  speech:any;
  client:any;
  configSTT: {};

  audioInput:any;
  recognizeStream:any;
  restartCounter:number = 0;
  lastAudioInput:any;

  resultEndTime:number = 0;
  isFinalEndTime:number = 0;
  finalRequestEndTime:number = 0;
  newStream:boolean = true;
  bridgingOffset:number = 0;
  lastTranscriptWasFinal:boolean = false;

  streamingLimit:number;

  onGetTextProgress:(mes: string)=>void;
  onGetText:(mes: string)=>void;
  onCompleteTranslate:(mes: string)=>void;

  constructor()
  {
    this.streamingLimit = sttConfig.streamingLimit;
    this.audioInput = [];
    this.lastAudioInput = [];

    // Imports the Google Cloud client library
    // Currently, only v1p1beta1 contains result-end-time
    this.speech = require('@google-cloud/speech').v1p1beta1;
    this.client = new speech.SpeechClient({
      projectId: 'speech2text-309411',
      keyFilename: './license.json',
    });
    this.configSTT = {
      encoding: sttConfig.encoding,
      sampleRateHertz: sttConfig.sampleRateHertz,
      languageCode: sttConfig.languageCode,
    };

    const self:any = this;

    const audioInputStreamTransform = new Writable({
      write(chunk, encoding, next) {
        if (self.newStream && self.lastAudioInput.length !== 0) {
          // Approximate math to calculate time of chunks
          const chunkTime = sttConfig.streamingLimit / self.lastAudioInput.length;
          if (chunkTime !== 0) {
            if (self.bridgingOffset < 0) {
              self.bridgingOffset = 0;
            }
            if (self.bridgingOffset > self.finalRequestEndTime) {
              self.bridgingOffset = self.finalRequestEndTime;
            }
            const chunksFromMS = Math.floor(
              (self.finalRequestEndTime - self.bridgingOffset) / chunkTime
            );
            self.bridgingOffset = Math.floor(
              (self.lastAudioInput.length - chunksFromMS) * chunkTime
            );

            for (let i = chunksFromMS; i < self.lastAudioInput.length; i++) {
              self.recognizeStream.write(self.lastAudioInput[i]);
            }
          }
          self.newStream = false;
        }

        self.audioInput.push(chunk);

        if (self.recognizeStream) {
          self.recognizeStream.write(chunk);
        }

        next();
      },

      final() {
        if (self.recognizeStream) {
          self.recognizeStream.end();
        }
      },
    });

    // Start recording and send the microphone input to the Speech API
    recorder
      .record({
        sampleRateHertz: sttConfig.sampleRateHertz,
        threshold: 0, // Silence threshold
        silence: '1.0',
        keepSilence: true,
        recordProgram: 'rec', // Try also "arecord" or "sox"
      })
      .stream()
      .on('error', err => {
        console.error('Audio recording error ' + err);
      })
      .pipe(audioInputStreamTransform);

    console.log('');
    console.log('Listening, press Ctrl+C to stop.');
    console.log('');
    console.log('End (ms)       Transcript Results/Status');
    console.log('=========================================================');

    this.startStream();
  }

  startStream(){
    this.audioInput = [];

    // Initiate (Reinitiate) a recognize stream
    this.recognizeStream = this.client
      .streamingRecognize({
        config:this.configSTT,
        interimResults: true,
      })
      .on('error', err => {
        if (err.code === 11) {
          // restartStream();
        } else {
          console.error('API request error ' + err);
        }
      })
      .on('data', this.speechCallback.bind(this));

    // Restart stream when streamingLimit expires
    setTimeout(this.restartStream, this.streamingLimit);
  }

  speechCallback(stream:any){
    // Convert API result end time from seconds + nanoseconds to milliseconds
    this.resultEndTime =
      stream.results[0].resultEndTime.seconds * 1000 +
      Math.round(stream.results[0].resultEndTime.nanos / 1000000);

    // Calculate correct time based on offset from audio sent twice
    const correctedTime =
      this.resultEndTime - this.bridgingOffset + this.streamingLimit * this.restartCounter;

    (<any>process.stdout).clearLine();
    (<any>process.stdout).cursorTo(0);
    let stdoutText = '';
    let resultText = '';
    if (stream.results[0] && stream.results[0].alternatives[0]) {
      stdoutText =
        correctedTime + ': ' + stream.results[0].alternatives[0].transcript;

      resultText = stream.results[0].alternatives[0].transcript;
    }

    if (stream.results[0].isFinal) {
      process.stdout.write(chalk.green(`${stdoutText}\n`));

      // 確定データ受ける
      if(this.onGetText) this.onGetText(resultText);


      // TRANSLATE!!!

      (async () => {

        try {
          const params = new URLSearchParams();
          params.append('auth_key',deeplAuthKey);
          params.append('text', resultText);
          params.append('target_lang', targetLang);
          // params.append('source_lang', sourceLang);

          const response = await axios.post(deeplUrl,params);
          console.log(response.data.translations[0].text);


          if(this.onCompleteTranslate) this.onCompleteTranslate(response.data.translations[0].text);

        } catch (error) {
          console.log(error.response);
        }
      })();

      this.isFinalEndTime = this.resultEndTime;
      this.lastTranscriptWasFinal = true;
    } else {
      // Make sure transcript does not exceed console character length
      if (stdoutText.length > process.stdout.columns) {
        stdoutText =
          stdoutText.substring(0, process.stdout.columns - 4) + '...';
      }
      process.stdout.write(chalk.red(`${stdoutText}`));

      // 途中経過のデータ受ける
      if(this.onGetTextProgress) this.onGetTextProgress(resultText);

      this.lastTranscriptWasFinal = false;
    }
  }

  restartStream(){
    if (this.recognizeStream) {
      this.recognizeStream.end();
      this.recognizeStream.removeListener('data', this.speechCallback);
      this.recognizeStream = null;
    }
    if (this.resultEndTime > 0) {
      this.finalRequestEndTime = this.isFinalEndTime;
    }
    this.resultEndTime = 0;

    this.lastAudioInput = [];
    this.lastAudioInput = this.audioInput;

    this.restartCounter++;

    if (!this.lastTranscriptWasFinal) {
      process.stdout.write('\n');
    }
    process.stdout.write(
      chalk.yellow(`${this.streamingLimit * this.restartCounter}: RESTARTING REQUEST\n`)
    );

    this.newStream = true;

    this.startStream();

  }
}