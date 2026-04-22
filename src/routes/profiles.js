'use strict';

const express = require('express');
const { getAllProfiles, searchProfiles } = require('../controllers/profilesController');

const router = express.Router();

// IMPORTANT: /search must be declared BEFORE /:id to avoid route shadowing
router.get('/search', searchProfiles);
router.get('/', getAllProfiles);

module.exports = router;
