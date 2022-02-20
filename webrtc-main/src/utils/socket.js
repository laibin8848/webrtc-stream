
import io from 'socket.io-client';
let host = location.origin;
// 'http://localhost:80'
const socket = io.connect(host);
export default socket;