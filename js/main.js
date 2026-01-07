import GameScene from './scenes/GameScene.js';
const TILE_SIZE = 32;

const config = {
    type: Phaser.AUTO,
    parent: 'game',
    width: 28 * TILE_SIZE,
    height: 16 * TILE_SIZE,
    backgroundColor: '#000000',
    pixelArt: true,
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 }, debug: false }
    },
    scene: [GameScene]
};

new Phaser.Game(config);