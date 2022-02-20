const Koa = require('koa');
const path = require('path');
const koaSend = require('koa-send');
const static = require('koa-static');
const socket = require('koa-socket');
const users = {}; // 保存用户
const sockS = {}; // 保存客户端对应的socket
const io = new socket({
    ioOptions: {
        pingTimeout: 10000,
        pingInterval: 5000,
    }
});

// 创建一个Koa对象表示web app本身:
const app = new Koa();
// socket注入应用
io.attach(app);
app.use(static(
    path.join( __dirname,  './public')
));

app.use(async (ctx, next) => {
    if (!/\./.test(ctx.request.url)) {
        await koaSend(
            ctx,
            'index.html',
            {
                root: path.join(__dirname, './'),
                maxage: 1000 * 60 * 60 * 24 * 7,
                gzip: true,
            }
        );
    } else {
        await next();
    }
});

app._io.on( 'connection', sock => {
    sock.on('join', data=>{
        sock.join(data.roomid, () => {
            if (!users[data.roomid]) {
                users[data.roomid] = [];
            }
            let obj = {
                account: data.account,
                id: sock.id
            };
            let arr = users[data.roomid].filter(v => v.account === data.account);
            if (!arr.length) {
                users[data.roomid].push(obj);
            }
            sockS[data.account] = sock;
            app._io.in(data.roomid).emit('joined', users[data.roomid], data.account, sock.id);
        });
    });

    sock.on('inputting', data=>{ // 正在输入中
        sockS[data.account].emit('inputting', data);
    });

    sock.on('apply', data=>{ // 转发申请
        sockS[data.account].emit('apply', data);
    });
    sock.on('reply', data=>{ // 转发回复
        sockS[data.account].emit('reply', data);
    });
    sock.on('1v1answer', data=>{ // 转发 answer
        sockS[data.account].emit('1v1answer', data);
    });
    sock.on('1v1ICE', data=>{ // 转发 ICE
        sockS[data.account].emit('1v1ICE', data);
    });
    sock.on('1v1offer', data=>{ // 转发 Offer
        sockS[data.account].emit('1v1offer', data);
    });
    sock.on('1v1hangup', data=>{ // 转发 hangup
        sockS[data.account].emit('1v1hangup', data);
    });
});
app._io.on('disconnect', (sock) => {
    for (let k in users) {
        users[k] = users[k].filter(v => v.id !== sock.id);
    }
    console.log(`disconnect id => ${users}`);
});

let port = 8088;
app.listen(port, _ => {
    console.log('app started at port ...' + port);
});