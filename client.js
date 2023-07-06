import axios from 'axios';
import envPaths from 'env-paths';
import fs from 'node:fs';
import GlobalOffensive from 'globaloffensive';
import inquirer from 'inquirer';
import localtunnel from 'localtunnel';
import makeDir from 'make-dir';
import path from 'node:path';
import { Server } from 'socket.io';
import SteamUser from 'steam-user';
import qrcode from 'qrcode-terminal';

// process.on('uncaughtException', (err) => {
//     console.log("CAUGHT");
//     process.exit(1);
// });

const { data: dataPath } = envPaths('CSGO-Case-Opener');
const tokenPath = path.join(dataPath, ".token");

if (!fs.existsSync(tokenPath)) {
    makeDir.sync(dataPath);
    fs.writeFileSync(tokenPath, '', { flag: 'w' });
}

let webSessionCookies = [];

const exposeServer = async () => {
    let tunnel;

    try {
        let { shouldExposePublicly } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'shouldExposePublicly',
                message: "Generate a public URL to access this server?",
                prefix: ''
            }
        ]);

        if (!shouldExposePublicly) return;

        console.log("Generating public URL...");
        tunnel = await localtunnel({ port: 3000 });
    } catch (err) {
        console.log("Error starting localtunnel. Restart program to get public URL.");
    }

    console.log(`Public URL: ${tunnel.url}`);
    qrcode.generate(tunnel.url, { small: true });
}

const startServer = async (csgo, user) => {
    console.log("Starting server...");

    const io = new Server({});

    io.on('connection', (socket) => {
        socket.on('get_inventory', async () => {
            let steamId = user.steamID.getSteamID64();

            try {
                let { data: inventory } = await axios.get(`https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=5000`, {
                    headers: {
                        'Cookie': webSessionCookies.join('; ')
                    }
                });

                socket.emit('get_inventory_response', inventory);
            } catch (err) {
                socket.emit('get_inventory_error', "Error fetching inventory. This is probably a rate limit, try again in a few seconds.");
                console.error("Error fetching inventory. This is probably a rate limit, try again in a few seconds.");
            }
        });

        socket.on('open_crate', ({ keyId, crateId }) => {
            if (!keyId || !crateId) {
                socket.emit('open_crate_error', "Must provide both keyId and crateId.");
                return;
            }

            csgo.openCrate(keyId, crateId);
        });

        socket.on('disconnect', () => {
            csgo.removeAllListeners('itemAcquired');
            csgo.removeAllListeners('crateOpenSuccess');
            csgo.removeAllListeners('crateOpenFailure');
            console.log("Client disconnected");
        });

        csgo.on('itemAcquired', (item) => {
            socket.emit('new_item', item);
        });

        csgo.on('crateOpenFailure', () => {
            socket.emit('open_crate_error', "Invalid keyId or crateId provided.");
        });

        console.log("Client connected");
    });

    io.listen(3000);
    console.log("Server started");

    exposeServer();
}

const startCSGO = async (user) => {
    let csgo = new GlobalOffensive(user);

    csgo.once('connectedToGC', () => {
        console.log("Logged into CS:GO");
        startServer(csgo, user);
    });

    user.gamesPlayed([730], true);
}

const loginToSteam = async () => {
    let user = new SteamUser();

    user.once('loggedOn', () => {
        console.log("Logged into Steam");
        startCSGO(user);
    });

    user.on('webSession', (session, cookies) => {
        webSessionCookies = cookies;
    });

    const token = fs.readFileSync(tokenPath, { encoding: 'utf-8' });

    if (token.length > 0) { // Token exists, just login with that
        console.log("Steam token found. Logging in...");
        user.logOn({
            refreshToken: token
        });

        return;
    }

    user.once('loginKey', (key) => {
        console.log("Steam login token received");
        fs.writeFileSync(tokenPath, key);
        console.log("Steam login token saved");
    });

    user.once('steamGuard', () => {
        console.error("Invalid Steam Guard code provided. Try again.");
        process.exit(1);
    });

    console.log("No Steam token found. Manual login required.");
    const { username, password, steamGuardCode } = await inquirer.prompt([
        {
            type: 'input',
            name: 'username',
            message: "Enter your Steam username:",
            prefix: ''
        },
        {
            type: 'input',
            name: 'password',
            message: "Enter your Steam password:",
            prefix: ''
        },
        {
            type: 'input',
            name: 'steamGuardCode',
            message: "Enter your Steam Guard code:",
            prefix: ''
        },
    ]);

    console.log("Logging in...");
    user.logOn({
        accountName: username,
        password: password,
        twoFactorCode: steamGuardCode,
        rememberPassword: true
    });
}

loginToSteam();