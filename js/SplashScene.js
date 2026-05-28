import { THEMES, LEVEL_TYPES } from "./config.js";

export default class SplashScene extends Phaser.Scene {

    constructor() {
        super("SplashScene");
    }

    create() {

        const w = this.game.config.width;
        const h = this.game.config.height;

        this.cameras.main.setBackgroundColor("#000000");

        // -------------------------------------------------
        // TITLE
        // -------------------------------------------------

        this.add.text(w / 2, 70, "LODE RUNNER", {
            fontFamily: "monospace",
            fontSize: 64,
            color: "#ffffff",
            stroke: "#0088ff",
            strokeThickness: 6
        }).setOrigin(0.5);

        // -------------------------------------------------
        // MENU STATE
        // -------------------------------------------------

        this.themeIndex = 0;
        this.levelTypeIndex = 0;

        this.activeMenu = "themes";

        this.themeTexts = [];
        this.levelTexts = [];

        // -------------------------------------------------
        // THEMES
        // -------------------------------------------------

        this.add.text(220, 150, "THEMES", {
            fontFamily: "monospace",
            fontSize: 28,
            color: "#ffff55"
        }).setOrigin(0.5);

        THEMES.forEach((theme, i) => {

            const t = this.add.text(
                220,
                220 + i * 45,
                theme,
                {
                    fontFamily: "monospace",
                    fontSize: 26,
                    color: "#666666"
                }
            ).setOrigin(0.5);

            this.themeTexts.push(t);
        });

        // -------------------------------------------------
        // LEVEL TYPES
        // -------------------------------------------------

        this.add.text(650, 150, "LEVEL TYPES", {
            fontFamily: "monospace",
            fontSize: 28,
            color: "#ffff55"
        }).setOrigin(0.5);

        LEVEL_TYPES.forEach((levelType, i) => {

            const cleanName = levelType
                .replace("_levels", "")
                .replace(/_/g, " ")
                .toUpperCase();

            const t = this.add.text(
                650,
                210 + i * 45,
                cleanName,
                {
                    fontFamily: "monospace",
                    fontSize: 22,
                    color: "#666666",
                    align: "center",
                    wordWrap: { width: 260 }
                }
            ).setOrigin(0.5);

            this.levelTexts.push(t);
        });

        // -------------------------------------------------
        // FOOTER
        // -------------------------------------------------

        this.add.text(
            w / 2,
            h - 120,
            "LEFT / RIGHT = CHANGE COLUMN\nUP / DOWN = SELECT\nENTER = START",
            {
                fontFamily: "monospace",
                fontSize: 18,
                color: "#55ffff",
                align: "center"
            }
        ).setOrigin(0.5);

        this.startText = this.add.text(
            w / 2,
            h - 50,
            "PRESS ENTER TO START",
            {
                fontFamily: "monospace",
                fontSize: 24,
                color: "#ffffff"
            }
        ).setOrigin(0.5);

        this.tweens.add({
            targets: this.startText,
            alpha: 0.25,
            yoyo: true,
            repeat: -1,
            duration: 500
        });

        // -------------------------------------------------
        // INPUT
        // -------------------------------------------------

        this.input.keyboard.on("keydown-LEFT", () => {

            this.activeMenu = "themes";
            this.refreshMenus();
        });

        this.input.keyboard.on("keydown-RIGHT", () => {

            this.activeMenu = "levels";
            this.refreshMenus();
        });

        this.input.keyboard.on("keydown-UP", () => {

            if (this.activeMenu === "themes") {

                this.themeIndex--;

                if (this.themeIndex < 0) {
                    this.themeIndex = THEMES.length - 1;
                }

            } else {

                this.levelTypeIndex--;

                if (this.levelTypeIndex < 0) {
                    this.levelTypeIndex = LEVEL_TYPES.length - 1;
                }
            }

            this.refreshMenus();
        });

        this.input.keyboard.on("keydown-DOWN", () => {

            if (this.activeMenu === "themes") {

                this.themeIndex++;

                if (this.themeIndex >= THEMES.length) {
                    this.themeIndex = 0;
                }

            } else {

                this.levelTypeIndex++;

                if (this.levelTypeIndex >= LEVEL_TYPES.length) {
                    this.levelTypeIndex = 0;
                }
            }

            this.refreshMenus();
        });

        this.input.keyboard.on("keydown-ENTER", () => {
            this.startGame();
        });

        this.input.on("pointerdown", () => {
            this.startGame();
        });

        this.refreshMenus();
    }

    refreshMenus() {

        // -------------------------------------
        // THEMES
        // -------------------------------------

        for (let i = 0; i < this.themeTexts.length; i++) {

            const t = this.themeTexts[i];

            const selected = i === this.themeIndex;
            const active = this.activeMenu === "themes";

            if (selected) {

                t.setColor("#ffffff");

                if (active) {
                    t.setBackgroundColor("#0044aa");
                } else {
                    t.setBackgroundColor("#333333");
                }

            } else {

                t.setColor("#666666");
                t.setBackgroundColor(null);
            }
        }

        // -------------------------------------
        // LEVEL TYPES
        // -------------------------------------

        for (let i = 0; i < this.levelTexts.length; i++) {

            const t = this.levelTexts[i];

            const selected = i === this.levelTypeIndex;
            const active = this.activeMenu === "levels";

            if (selected) {

                t.setColor("#ffffff");

                if (active) {
                    t.setBackgroundColor("#0044aa");
                } else {
                    t.setBackgroundColor("#333333");
                }

            } else {

                t.setColor("#666666");
                t.setBackgroundColor(null);
            }
        }
    }

    startGame() {

        const selectedTheme = THEMES[this.themeIndex];
        const selectedLevelType = LEVEL_TYPES[this.levelTypeIndex];

        this.registry.set("theme", selectedTheme);
        this.registry.set("levelType", selectedLevelType);

        this.cameras.main.flash(300, 255, 255, 255);

        this.time.delayedCall(300, () => {
            this.scene.start("GameScene");
        });
    }
}