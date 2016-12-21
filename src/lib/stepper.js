/**
 * Motor Wiring Scheme:
 *
 * Out 1: black
 * Out 2: green
 * Out 3: red
 * Out 4: blue
 *
 * Forward Motion Sequence:
 * black + blue (1, 0, 0, 1)
 * green + blue (0, 1, 0, 1)
 * green + red  (0, 1, 1, 0)
 * black + red  (1, 0, 1, 0)
 */

import _               from 'lodash';
import wpi, { OUTPUT } from 'wiring-pi';
import EventEmitter    from 'events';

export const MODES = {
  SINGLE: [
    [ 1, 0, 0, 0 ],
    [ 0, 1, 0, 0 ],
    [ 0, 0, 1, 0 ],
    [ 0, 0, 0, 1 ]
  ],
  DUAL: [
    [ 1, 0, 0, 1 ],
    [ 0, 1, 0, 1 ],
    [ 0, 1, 1, 0 ],
    [ 1, 0, 1, 0 ]
  ]
};

export const FORWARD = 1;
export const BACKWARD = -1;

export class Stepper extends EventEmitter {
  constructor({ pins, steps = 200, mode = MODES.DUAL, speed = 1 }) {
    super();
    this.mode       = mode;
    this.pins       = pins;
    this.steps      = steps;
    this.stepNum    = 0;
    this.moving     = false;
    this.direction  = null;
    this.speed      = speed;
    this._moveTimer = null;
    this._powered   = false;

    this._validateOptions();
    wpi.setup('gpio');

    for (let pin of this.pins) {
      wpi.pinMode(pin, OUTPUT);
    }
  }

  get maxRPM() {
    return 60 * 1000 / this.steps;
  }

  set speed(rpm) {
    this._rpms = rpm;

    if (this._rpms > this.maxRPM) {
      this._rpms = this.maxRPM;
    }

    this._stepDelay = this.maxRPM / this._rpms;
    this.emit('speed', this._rpms, this._stepDelay);
  }

  get speed() {
    return this._rpms;
  }

  stop() {
    this._stopMoving();
    this._powerDown();
    this.emit('stop');
  }

  hold() {
    this._stopMoving();
    this.emit('hold');
  }

  move(stepsToMove) {
    if (stepsToMove === 0) {
      return this.hold();
    }

    if (this.moving) {
      this.emit('cancel');
      this.hold();
    }

    this.moving    = true;
    let remaining  = Math.abs(stepsToMove);
    this.direction = stepsToMove > 0 ? FORWARD : BACKWARD;

    this.emit('start', this.direction, stepsToMove);

    this._moveTimer = setInterval(() => {
      if (remaining === 0) {
        this.emit('complete');
        this.hold();
      }
      this._step(this.direction);
      remaining--;
    }, this._stepDelay);
  }

  stepForward() {
    this._step(FORWARD);
  }

  stepBackward() {
    this._step(BACKWARD);
  }

  attachLogger(logger) {
    const childLog = logger.child({ module: 'Stepper' });

    this.on('power', () => childLog.info({ powered: this._powered }, 'power toggled'));
    this.on('speed', () => childLog.info({ rpms: this._rpms, stepDelay: this._stepDelay }, 'speed changed'));
    this.on('hold', () => childLog.info('holding position'));
    this.on('start', (direction, steps) => childLog.info({ direction, steps }, 'starting motion'));
    this.on('stop', () => childLog.info('stopping'));
    this.on('cancel', () => childLog.info('cancelling previous motion'));
    this.on('move', (direction, phase, pinStates) => {
      childLog.debug({ direction, phase, pinStates }, 'move one step');
    });
    this.on('complete', () => childLog.info({ numSteps: this._numSteps }, 'motion complete'));
  }

  _step(direction) {
    let phase;

    if (direction === FORWARD) {
      phase = this._incrementStep();
    } else if (direction === BACKWARD) {
      phase = this._decrementStep();
    } else {
      return;
    }

    const pinStates = this.mode[phase];

    this._setPinStates(...pinStates);
    this.emit('move', direction, phase, pinStates);
  }

  _stopMoving() {
    this._resetMoveTimer();
    this.moving = false;
  }

  _powerDown() {
    this._powered = false;
    this._setPinStates(0, 0, 0, 0);
    this.emit('power', false);
  }

  _setPinStates(...states) {
    if (states.length !== this.pins.length) {
      throw new Error(`Must pass exactly ${this.pins.length} pin states`);
    }

    for (let idx in states) {
      wpi.digitalWrite(this.pins[idx], states[idx]);

      if (!this._powered && states[idx] === 1) {
        this._powered = true;
        this.emit('power', true);
      }
    }
  }

  _resetMoveTimer() {
    clearInterval(this._moveTimer);
    this._moveTimer = null;
  }

  _incrementStep() {
    this.stepNum++;

    if (this.stepNum >= this.steps) {
      this.stepNum = 0;
    }

    return Math.abs(this.stepNum) % this.mode.length;
  }

  _decrementStep() {
    this.stepNum--;

    if (this.stepNum < 0) {
      this.stepNum = this.steps - 1;
    }

    return Math.abs(this.stepNum) % this.mode.length;
  }

  _validateOptions() {
    const { mode, pins } = this;
    const invalidStep    = _.findIndex(mode, (step) => step.length !== pins.length);

    if (invalidStep !== -1) {
      throw new Error(`Mode step at index ${invalidStep} has the wrong number of pins`);
    }
  }
}

export default Stepper;
