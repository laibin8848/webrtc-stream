<template>
    <div class="remote"
         v-loading="loading"
         :element-loading-text="loadingText"
         element-loading-spinner="el-icon-loading"
         element-loading-background="rgba(0, 0, 0, 0.8)"
    >
        <div class="video-container">
            <div class="product-box">
                <ul>
                    <li @dragstart="onDragstart($event, 'image', 'static/image.jpg')" draggable="true"><img draggable="false" src="static/image.jpg" /></li>
                    <li @dragstart="onDragstart($event, 'image', 'static/image2.jpg')" draggable="true"><img draggable="false" src="static/image2.jpg" /></li>
                    <li @dragstart="onDragstart($event, 'video', 'static/video.mp4')" draggable="true"><video  src="static/video.mp4"></video></li>
                </ul>
            </div>
            <div class="target-box">
                <div class="input-status-bar" v-if="inputState">Inputting……</div>
                <div class="target-drop-box" @dragover="onDragover" @dragenter="onDragenter" @drop="onDrop">
                    <div>please drag product to here……</div>
                    <div v-show="!showVideo"><canvas style="width: 400px;height: 300px;" ref="canvas"></canvas></div>
                    <div v-show="showVideo"><video id="videoCon" style="width: 200px;height: 200px;" ref="video" controls autoplay></video></div>
                    <img width="100" height="100" style="display: none;" src="" id="currentImage" />
                </div>
                <div class="chat">
                    <div class="message" v-for="(v, i) in messageList" :key="i">
                        from : {{v.account}} - {{v.time}} - {{v.mes}}
                    </div>
                </div>
                <textarea style="width: 98%" @input="onInput" v-model="sendText"></textarea> <br>
                <!-- <button @click="changeStream">changeStream</button> -->
                <button :disabled="!sendText" @click="send(['text'])">Send</button>
            </div>
        </div>
        <div class="mobile-container">
            <iframe style="width: 100%;height: 100%;border: 0;" src="/#/mobile" />
        </div>
    </div>
</template>
<script>
    import socket from '../../utils/socket';

    export default{
        name: 'share-demo',
        data() {
            return {
                account: 'pc',
                roomid: 'share-demo', // 指定房间ID
                isCall: false, // 正在通话的对象
                loading: false,
                loadingText: 'connecting......',
                isToPeer: false, // 是否建立了 P2P 连接
                peer: null,
                offerOption: {
                    offerToReceiveAudio: 1,
                    offerToReceiveVideo: 1
                },
                localstreamVideo: null,
                localstreamImage: null,
                channel: null,
                messageList: [],
                sendText: '',
                inputState: false,
                showVideo: false,
                currentStream: null
            };
        },
        methods: {
            formatTime(date) {
                const hour = date.getHours();
                const minute = date.getMinutes();
                const second = date.getSeconds();
                return [hour, minute, second].map(this.formatNumber).join(':');
            },
            formatNumber(n) {
                n = n.toString();
                return n[1] ? n : '0' + n;
            },
            send(arr) { // 发送消息
                if (arr[0] === 'text') {
                    let params = {account: this.account, time: this.formatTime(new Date()), mes: this.sendText, type: 'text'};
                    this.channel.send(JSON.stringify(params));
                    this.messageList.push(params);
                    this.sendText = '';
                } else {
                    this.channel.send(JSON.stringify(arr));
                }
            },
            onInput() {
                socket.emit('inputting', {roomid: this.roomid, account: 'mobile'});
            },
            join() {
                if (!this.account) return;
                socket.emit('join', {roomid: this.roomid, account: this.account});
                setTimeout(()=> {
                    //主动向mobile端发起连接请求
                    socket.emit('apply', {account: 'mobile', self: this.account});
                }, 2000);
            },
            initSocket() {
                socket.on('inputting', () =>{
                    this.inputState = true;
                    setTimeout(()=> {
                        this.inputState = false;
                    }, 2000);
                });
                socket.on('reply', async data =>{ // 收到回复
                    this.loading = false;
                    this.isCall = data.self;
                    // 对方同意之后创建自己的 peer
                    await this.createP2P(data);
                    // 建立DataChannel
                    await this.createDataChannel();
                    // 并给对方发送 offer
                    this.createOffer(data);
                });
                socket.on('1v1answer', (data) =>{ // 接收到 answer
                    this.onAnswer(data);
                });
                socket.on('1v1ICE', (data) =>{ // 接收到 ICE
                    this.onIce(data);
                });
                socket.on('1v1offer', (data) =>{ // 接收到 offer
                    this.onOffer(data);
                });
            },
            reply(account, type) {
                socket.emit('reply', {account: account, self: this.account, type: type});
            },
            async createP2P(data) {
                this.loading = true;
                await this.initPeer(data); // 获取到媒体流后，调用函数初始化 RTCPeerConnection
            },
            createDataChannel() {
                try{
                    this.channel = this.peer.createDataChannel('messagechannel');
                    this.handleChannel(this.channel);
                } catch (e) {
                    console.log('createDataChannel:', e);
                }
            },
            onDataChannel() { // 接收 DataChannel
                this.peer.ondatachannel = (event) => {
                    this.channel = event.channel;
                    this.handleChannel(this.channel);
                };
            },
            handleChannel(channel) { // 处理 channel
                channel.binaryType = 'arraybuffer';
                channel.onopen = (event) => { // 连接成功
                    console.log('channel onopen', event);
                    this.isToPeer = true; // 连接成功
                    this.loading = false;
                };
                channel.onclose = function(event) { // 连接关闭
                    console.log('channel onclose', event);
                };
                channel.onmessage = (e) => { // 收到消息
                    if (Array.isArray(JSON.parse(e.data))) {
                        let [type, ...arr] = JSON.parse(e.data);
                        this.palette[type](...arr);
                    } else {
                        this.messageList.push(JSON.parse(e.data));
                    }
                };
            },
            initPeer(data) {
                // 创建输出端 PeerConnection
                let PeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
                this.peer = new PeerConnection();
                if(this.showVideo) {
                    this.currentStream = this.$refs['video'].captureStream();
                } else {
                    this.currentStream = this.$refs['canvas'].captureStream();
                }
                this.peer.addStream(this.currentStream);
                // 监听ICE候选信息 如果收集到，就发送给对方
                this.peer.onicecandidate = (event) => {
                    if (event.candidate) {
                        socket.emit('1v1ICE', {account: data.self, self: this.account, sdp: event.candidate});
                    }
                };
            },
            async createOffer(data) { // 建立DataChannel，创建并发送 offer
                try {
                    // 创建offer
                    let offer = await this.peer.createOffer(this.offerOption);
                    // 呼叫端设置本地 offer 描述
                    await this.peer.setLocalDescription(offer);
                    // 给对方发送 offer
                    socket.emit('1v1offer', {account: data.self, self: this.account, sdp: offer});
                } catch (e) {
                    console.log('createOffer: ', e);
                }
            },
            async onOffer(data) { // 接收offer并发送 answer
                try {
                    // 接收端设置远程 offer 描述
                    await this.peer.setRemoteDescription(data.sdp);
                    // 接收端创建 answer
                    let answer = await this.peer.createAnswer();
                    // 接收端设置本地 answer 描述
                    await this.peer.setLocalDescription(answer);
                    // 给对方发送 answer
                    socket.emit('1v1answer', {account: data.self, self: this.account, sdp: answer});
                } catch (e) {
                    console.log('onOffer: ', e);
                }
            },
            async onAnswer(data) { // 接收answer
                try {
                    await this.peer.setRemoteDescription(data.sdp); // 呼叫端设置远程 answer 描述
                } catch (e) {
                    console.log('onAnswer: ', e);
                }
            },
            async onIce(data) { // 接收 ICE 候选
                try {
                    await this.peer.addIceCandidate(data.sdp); // 设置远程 ICE
                } catch (e) {
                    console.log('onAnswer: ', e);
                }
            },
            resetCanvas() {
                const canvas = this.$refs['canvas']
                const ctx = canvas.getContext('2d')
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            },
            changeStream(isVideo, source) {
                this.showVideo = isVideo;
                if(this.showVideo) {
                    document.querySelector('#videoCon').src = source;
                } else {
                    document.querySelector('#currentImage').src = source;
                    setTimeout(()=> {
                        this.addStreamToImage();
                    }, 2000);
                }
                setTimeout(()=> {
                    //主动向mobile端发起连接请求
                    socket.emit('apply', {account: 'mobile', self: this.account});
                }, 1000);
            },
            addStreamToImage() {
                this.resetCanvas();
                const ctx = this.$refs['canvas'].getContext('2d')
                ctx.drawImage(document.getElementById('currentImage'), 100, 0)
            },
            onDragover(e) {
                e.preventDefault();
            },
            onDragenter() {
                this.onInput();
            },
            onDrop(e) {
                const souce = e.dataTransfer.getData('productSource');
                const type = e.dataTransfer.getData('productType');
                (souce && type) && this.changeStream(type === 'video', souce);
            },
            onDragstart(e, type, source) {
                e.dataTransfer.setData('productSource', source);
                e.dataTransfer.setData('productType', type);
            }
        },
        clearState() { // 清除状态
            this.peer.close();
            this.channel.close();
            this.peer = null;
            this.channel = null;
            this.isToPeer = false;
            this.isCall = false;
        },
        mounted() {
            this.initSocket();
            this.loading = true;
            this.join();
        }
    }
</script>
<style lang="scss" scoped>
    .remote{
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: flex-start;
        background: #eaeaea;
        padding: 30px 0 0 30px;
    }
    .video-container{
        .product-box {
            margin-right: 10px;
            cursor: move;
            li {
                width: 100px;
                height: 100px;
                border: 1px #000 solid;
                margin-bottom: 4px;
                overflow: hidden;
                img {
                    width: 100%;
                }
                video {
                    width: 100%;
                    height: 100%;
                }
            }
        }
        .target-box {
            border: 1px #000 solid;
            .target-drop-box {
                width: 100%;
                height: auto;
                background: #ccc;
                display: flex;
                align-items: center;
                flex-direction: column;
            }
        }
        .input-status-bar {
            width: 100%;
            height: 28px;
            line-height: 28px;
            color: #999;
            text-align: center;
        }
        display: flex;
        justify-content: center;
        >div:first-child{
            display: flex;
            justify-content: flex-start;
            canvas{
                border: 1px solid #000;
            }
            ul{
                text-align: left;
            }
        }
        .chat{
            text-align: left;
            padding: 5px;
            .message{
                line-height: 24px;
                border-bottom: 1px #ccc dotted;
            }
        }
    }
    .mobile-container {
        width: 500px;
        height: 100%;
    }
</style>