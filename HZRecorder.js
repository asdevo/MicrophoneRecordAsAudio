(function (window) {
    //兼容
    window.URL = window.URL || window.webkitURL;
    navigator.getUserMedia = navigator.getUserMedia 
        || navigator.webkitGetUserMedia 
        || navigator.mozGetUserMedia 
        || navigator.msGetUserMedia;

    var HZRecorder = function (stream, config) {
        config = config || {};
        config.sampleBits = config.sampleBits || 8;      //采样数位 8, 16，要求能被8整除
        config.sampleRate = config.sampleRate || (44100 / 6);   //采样率(1/6 44100)
        config.format = config.format || 'mp3';
        config.slice = config.slice || false;

        var context;// = new (window.AudioContext || window.webkitAudioContext)();
        var audioInput;// = context.createMediaStreamSource(stream);//音频输入源
        var createScript;// = context.createScriptProcessor || context.createJavaScriptNode;
        var recorder;// = createScript.apply(context, [4096, 1, 1]);//音频处理器[缓冲区大小,输入声道数,输出声道数]

        var audioData = {
            size: 0                                     //录音文件长度
            , buffer: []                                //录音缓存
            , slice: config.slice                       //是否分段
            , section: []                               //当前分段
            // , inputSampleRate: context.sampleRate       //输入采样率，默认48000
            , inputSampleBits: 16                       //输入采样数位 8, 16
            // , outputSampleRate: config.sampleRate       //输出采样率
            // , oututSampleBits: config.sampleBits        //输出采样数位 8, 16
            , input: function (data) {
                // console.log('record input...')
                this.buffer.push(new Float32Array(data));
                this.size += data.length;
            }
            , compress: function () { //合并压缩
                //合并
                this.section = this.buffer.slice(0);
                var size = this.size;
                if(this.slice) {
                    this.size = 0;
                    this.buffer = [];
                }
                var data = new Float32Array(size);
                var offset = 0;
                for (var i = 0; i < this.section.length; i++) {
                    data.set(this.section[i], offset);
                    offset += this.section[i].length;
                }
                //采样压缩
                var compression = parseInt(this.inputSampleRate / this.outputSampleRate);
                var length = data.length / compression;
                var result = new Float32Array(length);
                var index = 0, j = 0;
                while (index < length) {
                    result[index] = data[j];
                    j += compression;
                    index++;
                }
                return result;
            }
            , encodeMP3: function () {
                var sampleRate = Math.min(this.inputSampleRate, this.outputSampleRate);
                var sampleBits = Math.min(this.inputSampleBits, this.oututSampleBits);
                var sampleBlockSize = 1152;// n*576 per
                var dataBuffer = [];
                var mp3Encoder = new (new lamejs()).Mp3Encoder(1, sampleRate, 8*sampleBits);
                var bytes = this.compress();

                var appendToBuffer = function (mp3Buf) {
                    dataBuffer.push(new Int8Array(mp3Buf));
                };

                var dataLength = bytes.length * (sampleBits / 8);
                var buffer = new ArrayBuffer(dataLength);
                var data = new DataView(buffer);
                var offset = 0;
                if (sampleBits === 8) {
                    for (var i = 0; i < bytes.length; i++, offset++) {
                        var s = Math.max(-1, Math.min(1, bytes[i]));
                        var val = s < 0 ? s * 0x8000 : s * 0x7FFF;
                        val = parseInt(255 / (65535 / (val + 32768)));
                        data.setInt8(offset, val, true);
                    }
                } else {
                    for (var i = 0; i < bytes.length; i++, offset += 2) {
                        var s = Math.max(-1, Math.min(1, bytes[i]));
                        data.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                    }
                }
                data = new Int16Array(buffer);
                var remaining = data.length;
                for (var i = 0; remaining >= 0; i += sampleBlockSize) {
                    var chunk = data.subarray(i, i + sampleBlockSize);
                    var mp3buf = mp3Encoder.encodeBuffer(chunk);
                    mp3buf.length && appendToBuffer(mp3buf);
                    remaining -= sampleBlockSize;
                }
                appendToBuffer(mp3Encoder.flush());

                return new Blob(dataBuffer, { type: 'audio/mp3' });
            }
            , encodeWAV: function () {
                var sampleRate = Math.min(this.inputSampleRate, this.outputSampleRate);
                var sampleBits = Math.min(this.inputSampleBits, this.oututSampleBits);
                var bytes = this.compress();
                var dataLength = bytes.length * (sampleBits / 8);
                var buffer = new ArrayBuffer(44 + dataLength);
                var data = new DataView(buffer);

                var channelCount = 1;//单声道
                var offset = 0;

                var writeString = function (str) {
                    for (var i = 0; i < str.length; i++) {
                        data.setUint8(offset + i, str.charCodeAt(i));
                    }
                }

                // 资源交换文件标识符 
                writeString('RIFF'); offset += 4;
                // 下个地址开始到文件尾总字节数,即文件大小-8 
                data.setUint32(offset, 36 + dataLength, true); offset += 4;
                // WAV文件标志
                writeString('WAVE'); offset += 4;
                // 波形格式标志 
                writeString('fmt '); offset += 4;
                // 过滤字节,一般为 0x10 = 16 
                data.setUint32(offset, 16, true); offset += 4;
                // 格式类别 (PCM形式采样数据) 
                data.setUint16(offset, 1, true); offset += 2;
                // 通道数 
                data.setUint16(offset, channelCount, true); offset += 2;
                // 采样率,每秒样本数,表示每个通道的播放速度 
                data.setUint32(offset, sampleRate, true); offset += 4;
                // 波形数据传输率 (每秒平均字节数) 单声道×每秒数据位数×每样本数据位/8 
                data.setUint32(offset, channelCount * sampleRate * (sampleBits / 8), true); offset += 4;
                // 快数据调整数 采样一次占用字节数 单声道×每样本的数据位数/8 
                data.setUint16(offset, channelCount * (sampleBits / 8), true); offset += 2;
                // 每样本数据位数 
                data.setUint16(offset, sampleBits, true); offset += 2;
                // 数据标识符 
                writeString('data'); offset += 4;
                // 采样数据总数,即数据总大小-44 
                data.setUint32(offset, dataLength, true); offset += 4;
                // 写入采样数据 
                if (sampleBits === 8) {
                    for (var i = 0; i < bytes.length; i++, offset++) {
                        var s = Math.max(-1, Math.min(1, bytes[i]));
                        var val = s < 0 ? s * 0x8000 : s * 0x7FFF;
                        val = parseInt(255 / (65535 / (val + 32768)));
                        data.setInt8(offset, val, true);
                    }
                } else {
                    for (var i = 0; i < bytes.length; i++, offset += 2) {
                        var s = Math.max(-1, Math.min(1, bytes[i]));
                        data.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                    }
                }

                return new Blob([data], { type: 'audio/wav' });
            }
        };

        this.initStart = function() {
            context = new (window.AudioContext || window.webkitAudioContext)();
            audioInput = context.createMediaStreamSource(stream);//音频输入源
            createScript = context.createScriptProcessor || context.createJavaScriptNode;
            recorder = createScript.apply(context, [4096, 1, 1]);//音频处理器[缓冲区大小,输入声道数,输出声道数]

            $.extend(audioData, {
                slice: config.slice                         //是否分段
                , inputSampleRate: context.sampleRate       //输入采样率，默认48000
                , outputSampleRate: config.sampleRate       //输出采样率
                , oututSampleBits: config.sampleBits        //输出采样数位 8, 16
            });

            //音频采集
            recorder.onaudioprocess = function (e) {
                // 收割单通道
                audioData.input(e.inputBuffer.getChannelData(0));
            }
        }

        //开始录音
        this.start = function () {
            this.initStart();
            audioInput.connect(recorder);
            recorder.connect(context.destination);
        }

        //停止录音
        this.stop = function (force) {
            if(!config.slice || force) {
                stream.getAudioTracks().map(function(t){ t && t.stop() });
                recorder.disconnect();
                audioInput && audioInput.disconnect();
            }
        }

        //销毁
        this.destroy = function() {
            this.stop(true);
            context.close();
            audioInput = createScript = recorder = null;
        }

        //获取音频文件
        this.getBlob = function () {
            this.stop();
            var format = config.format;
            return format == 'wav'? audioData.encodeWAV() : audioData.encodeMP3();
        }

        //回放
        this.play = function (audio) {
            audio.src = window.URL.createObjectURL(this.getBlob());
        }

    };
    //抛出异常
    HZRecorder.throwError = function (message) {
        alert(message);
        throw new Error(message)
    }
    //是否支持录音
    HZRecorder.canRecording = (navigator.mediaDevices != null || navigator.getUserMedia != null);
    //获取录音机
    HZRecorder.get = function (callback, config) {
        if (callback) {
            var permission = { audio: true };
            var onSuccess = function (stream) {
                var rec = new HZRecorder(stream, config);
                callback(rec);
            };
            var onError = function (error) {
                switch (error.name) {
                    case 'PERMISSION_DENIED':
                    case 'PermissionDeniedError':
                        HZRecorder.throwError('用户拒绝提供信息。');
                        break;
                    case 'NOT_SUPPORTED_ERROR':
                    case 'NotSupportedError':
                        HZRecorder.throwError('仅支持Https下访问。');
                        break;
                    case 'MANDATORY_UNSATISFIED_ERROR':
                    case 'MandatoryUnsatisfiedError':
                        HZRecorder.throwError('无法发现指定的硬件设备。');
                        break;
                    default:
                        HZRecorder.throwError('无法打开麦克风。异常' + (error.name));
                        break;
                }
            };
            if (navigator.mediaDevices) {
                navigator.mediaDevices.getUserMedia(permission).then(onSuccess).catch(onError);
            } else if (navigator.getUserMedia) {
                navigator.getUserMedia(permission, onSuccess, onError);
            } else {
                HZRecorder.throwError('当前浏览器不支持录音功能。'); return;
            }
        }
    }

    window.HZRecorder = HZRecorder;

})(window);