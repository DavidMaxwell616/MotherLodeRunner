import SplashScene from './SplashScene.js';
import GameScene from './GameScene.js';

const TS = 32;

const config = {
    type: Phaser.AUTO,
    parent: 'game',
    width: 28 * TS,
    height: 16 * TS,
    backgroundColor: '#000000',
    pixelArt: true,
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 }, debug: true }
    },
    scene: [SplashScene, GameScene]
};

new Phaser.Game(config);