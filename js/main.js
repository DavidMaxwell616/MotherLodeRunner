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
        arcade: { gravity: { y: 0 }, debug: false }
    },
    scene: [GameScene]
};

new Phaser.Game(config);