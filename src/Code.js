/**
 * CSA Blueprint Presentation Generator v45.4
 * 
 * Alignments & Structural Fixes:
 * - Slide 1: 
 *    - Scans both Shapes AND Tables for the combined tag:
 *      {{Solution_Architect}}/{{Project_Manager}}/{{Executive_Sponsor}}/{{Team_Contributors}}
 *    - Performs atomic replacement to avoid multi-line bloating and leftover slashes.
 *    - Converts pipe delimiters ('|') in author names to clean, comma-separated lists.
 *    - Uniform metadata font compression (7.2pt, 102% line spacing) across ALL table cells
 *      (including Key Dates, Portfolio, Authors, and EVP) to prevent vertical drift and 
 *      keep Key Dates locked in alignment while preserving CDS logo clearance.
 * - Slide 2: 
 *    - Target Outcomes inserts a dedicated newline before bullet points begin.
 *    - Problem Statement font size is locked to match Target Outcomes base font size.
 *    - Composite summary fallback enforces a clean multi-line boundary (\n\n).
 * - Slide 3: Continuous 3-column markdown rendering (What, How, Why) with typo fallbacks.
 * - Slide 4: Pure 4-8-4 principles narrative mode; strips and suppresses auto-prepended meta prefixes.
 * - Slide 5: Dynamic 6-row table chunking with pagination markers; bolds Technology Name; renders markdown bold runs in Justification.
 * - Slides 6-10: Adaptive narrative markdown rendering with title-case bolding and safe vertical margins.
 * - Slide 11: 1:1 transaction flow alignment; resilient fallback for bulleted string or step array.
 * - Slide 12: Dynamic 3-card chunking across duplicated slides; eliminates orphaned divider slide; 4-row cards with top-alignment padding and UI clearances.
 * - Slide 13: Full table and shape inspection; dynamic 6-item chunking supporting Category placeholders and dynamic semantic coloring.
 */

function onOpen() {
  SlidesApp.getUi()
    .createMenu('CSA Generator')
    .addItem('1. Generate CSA Deck (Slides)', 'showDialog')
    .addSeparator() 
    .addItem('2. Authenticate with Lucidchart', 'showLucidAuthModal')
    .addItem('3. Generate Diagrams in Lucidchart', 'triggerLucidGeneration')
    .addToUi();
}

function showDialog() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.mode = 'slides';
  const html = template.evaluate().setWidth(620).setHeight(480);
  SlidesApp.getUi().showModalDialog(html, 'Inject CSA JSON Payload');
}

function showLucidAuthModal() {
  const authUrl = getLucidAuthUrl(); 
  const html = HtmlService.createHtmlOutput(`<div style="font-family: Arial, sans-serif; padding: 20px;">
      <h3>Connect to Lucidchart</h3>
      <p>Click the link below to authorize this tool to create diagrams in your Lucid account.</p>
      <a href="${authUrl}" target="_blank" style="background-color: #0F9D58; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block;">Login to Lucidchart</a>
    </div>`)
    .setWidth(400)
    .setHeight(200);
  SlidesApp.getUi().showModalDialog(html, 'Lucidchart Authentication');
}

function triggerLucidGeneration() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.mode = 'lucid';
  const html = template.evaluate().setWidth(620).setHeight(480);
  SlidesApp.getUi().showModalDialog(html, 'Inject Lucidchart JSON Payload');
}

function processJsonFromUi(jsonString) {
  try {
    return generateCSADeck(jsonString);
  } catch (error) {
    throw new Error('Deck Generation Failed: ' + error.message);
  }
}

function processLucidJsonFromUi(jsonString) {
  try {
    const payload = JSON.parse(jsonString);
    // Calls the main generator function in Lucid.js
    return pushPayloadToLucid(payload);
  } catch (error) {
    throw new Error('Lucid Diagram Generation Failed: ' + error.message);
  }
}

function generateCSADeck(jsonString) {
  const payload = JSON.parse(jsonString);
  const activeDeck = SlidesApp.getActivePresentation();
  const templateFile = DriveApp.getFileById(activeDeck.getId());
  const parentFolder = templateFile.getParents().hasNext()
    ? templateFile.getParents().next()
    : DriveApp.getRootFolder();

  const title = payload.Slide1_Metadata?.Project_Title || 'CSA_Initiative';
  const newDeckFile = templateFile.makeCopy(`CSA_Generated_${title}`, parentFolder);
  const deck = SlidesApp.openById(newDeckFile.getId());
  let slides = deck.getSlides();

  // ==========================================
  // SLIDE 1: Metadata, Personnel & Logo Clearance
  // ==========================================
  if (payload.Slide1_Metadata && slides[0]) {
    const s1 = slides[0];
    const meta = payload.Slide1_Metadata;
    
    s1.replaceAllText('{{Project_ID}}', meta.Project_Title || '');
    s1.replaceAllText('{{Demand_ID}}', meta.Demand_ID || '');
    s1.replaceAllText('{{Portfolio}}', meta.Portfolio || '');
    s1.replaceAllText('{{Top_EVP_Effort}}', meta.Top_EVP_Effort || 'Yes');
    s1.replaceAllText('{{Creation_Date}}', meta.Creation_Date || '');
    
    // Typo fallback for unclosed date tag on Slide 1
    s1.replaceAllText('{{Updated_Date}}', meta.Updated_Date || '');
    s1.replaceAllText('{{Updated_Date}', meta.Updated_Date || '');
    s1.replaceAllText('{{Presented_Date}}', meta.Presented_Date || '');

    // Format authors: convert pipe delimiters to clean comma list
    let rawArchitect = (meta.Lead_Architect || meta.Solution_Architect || '').trim();
    let formattedArchitect = rawArchitect;
    if (rawArchitect.includes('|')) {
      formattedArchitect = rawArchitect.split('|').map(a => a.trim()).filter(Boolean).join(', ');
    }
    if (meta.Co_Architects) {
      formattedArchitect += (formattedArchitect ? ', ' : '') + meta.Co_Architects.trim();
    }

    const personnelBlock = [
      formattedArchitect ? `Authors: ${formattedArchitect}` : '',
      meta.Project_Manager ? `PM: ${meta.Project_Manager}` : '',
      meta.Executive_Sponsor ? `Executive Sponsor: ${meta.Executive_Sponsor}` : '',
      meta.Team_Contributors ? `Key Contributors: ${meta.Team_Contributors}` : ''
    ].filter(Boolean).join('\n');

    const combinedPersonnelTag = '{{Solution_Architect}}/{{Project_Manager}}/{{Executive_Sponsor}}/{{Team_Contributors}}';
    let hasCombinedTag = false;

    const checkTextForTag = (textRange) => {
      const txt = textRange.asString();
      return txt.includes('{{Solution_Architect}}/') || txt.includes(combinedPersonnelTag) || txt.includes('{{Solution_Architect}}');
    };

    s1.getShapes().forEach(shape => {
      try { if (checkTextForTag(shape.getText())) hasCombinedTag = true; } catch (e) {}
    });

    s1.getTables().forEach(table => {
      for (let r = 0; r < table.getNumRows(); r++) {
        for (let c = 0; c < table.getRow(r).getNumCells(); c++) {
          try { if (checkTextForTag(table.getCell(r, c).getText())) hasCombinedTag = true; } catch (e) {}
        }
      }
    });

    if (hasCombinedTag) {
      s1.replaceAllText(combinedPersonnelTag, personnelBlock);
      s1.replaceAllText('{{Solution_Architect}}/', personnelBlock ? personnelBlock + '\n' : '');
      s1.replaceAllText('/{{Project_Manager}}', '');
      s1.replaceAllText('{{Project_Manager}}/', '');
      s1.replaceAllText('/{{Executive_Sponsor}}', '');
      s1.replaceAllText('{{Executive_Sponsor}}/', '');
      s1.replaceAllText('/{{Team_Contributors}}', '');
      s1.replaceAllText('{{Team_Contributors}}', '');
      s1.replaceAllText('{{Solution_Architect}}', personnelBlock);
      s1.replaceAllText('{{Authors_Block}}', personnelBlock);
    } else {
      s1.replaceAllText('{{Solution_Architect}}', formattedArchitect);
      s1.replaceAllText('{{Authors_Block}}', formattedArchitect);
      s1.replaceAllText('{{Project_Manager}}', meta.Project_Manager || '');
      s1.replaceAllText('{{Executive_Sponsor}}', meta.Executive_Sponsor || '');
      s1.replaceAllText('{{Team_Contributors}}', meta.Team_Contributors || '');
    }

    // Format shapes on Slide 1
    s1.getShapes().forEach(shape => {
      try {
        const textRange = shape.getText();
        const str = textRange.asString();
        const titleText = meta.Project_Title;
        
        if (titleText && str.includes(titleText)) {
          const idx = str.indexOf(titleText);
          const range = textRange.getRange(idx, idx + titleText.length);
          if (titleText.length > 60) {
            range.getTextStyle().setBold(true).setFontSize(10.5);
          } else if (titleText.length > 35) {
            range.getTextStyle().setBold(true).setFontSize(12);
          } else {
            range.getTextStyle().setBold(true).setFontSize(14.5);
          }
        }
        
        if (str.includes('Demand ID:')) {
          const dIdx = str.indexOf('Demand ID:');
          textRange.getRange(dIdx, str.length).getTextStyle().setFontSize(8.5).setBold(false);
        }

        if (str.includes('Authors:') || str.includes('PM:') || str.includes('Executive Sponsor:')) {
          textRange.getTextStyle().setFontSize(7.2).setBold(false).setForegroundColor('#333333');
          textRange.getParagraphs().forEach(p => {
            try {
              p.getRange().getParagraphStyle().setLineSpacing(102).setSpaceAbove(0).setSpaceBelow(0);
            } catch (e) {}
          });
        }
      } catch (e) {}
    });

    // Format ALL table cells on Slide 1 uniformly to prevent vertical drift
    s1.getTables().forEach(table => {
      for (let r = 0; r < table.getNumRows(); r++) {
        for (let c = 0; c < table.getRow(r).getNumCells(); c++) {
          try {
            const cell = table.getCell(r, c);
            const cellText = cell.getText();
            cellText.getTextStyle().setFontSize(7.2);
            cellText.getParagraphs().forEach(p => {
              try {
                p.getRange().getParagraphStyle().setLineSpacing(102).setSpaceAbove(0).setSpaceBelow(0);
              } catch (e) {}
            });
          } catch (e) {}
        }
      }
    });
  }

  // ==========================================
  // SLIDE 2: Executive Summary (Spacing & Locked Font Sizing)
  // ==========================================
  const s2 = findSlideByPlaceholder(deck, '{{Problem_Statement}}') || slides[1];
  if (payload.Slide2_ExecSummary && s2) {
    const exec = payload.Slide2_ExecSummary;
    
    let hasTargetOutcomesTag = false;
    s2.getShapes().forEach(s => {
      try { if (s.getText().asString().includes('{{Target_Outcomes}}')) hasTargetOutcomesTag = true; } catch(e) {}
    });
    if (!hasTargetOutcomesTag) {
      s2.getTables().forEach(t => {
        for (let r = 0; r < t.getNumRows(); r++) {
          for (let c = 0; c < t.getRow(r).getNumCells(); c++) {
            try { if (t.getCell(r, c).getText().asString().includes('{{Target_Outcomes}}')) hasTargetOutcomesTag = true; } catch(e) {}
          }
        }
      });
    }

    let cleanProb = normalizeSlide2Section(exec.Problem_Statement || '', 'Problem Statement');
    let cleanTarget = normalizeSlide2Section(exec.Target_Outcomes || '', 'Target Outcomes');

    // Lock font size strictly to Target Outcomes baseline
    const targetOutcomesFontSize = cleanTarget 
      ? getTailoredFontSize(cleanTarget.length, 7.5, 8.5)
      : (cleanProb ? getTailoredFontSize(cleanProb.length, 7.5, 8.5) : 8.0);

    if (hasTargetOutcomesTag) {
      if (cleanProb) injectSlide2ExecutiveSummary(s2, '{{Problem_Statement}}', cleanProb, targetOutcomesFontSize);
      if (cleanTarget) injectSlide2ExecutiveSummary(s2, '{{Target_Outcomes}}', cleanTarget, targetOutcomesFontSize);
    } else {
      // SPACING FIX: Exactly 2 line breaks (1 empty line) between the Problem Statement and Target Outcomes
      const compositeSummary = `${cleanProb}\n\n${cleanTarget}`;
      injectSlide2ExecutiveSummary(s2, '{{Problem_Statement}}', compositeSummary.trim(), targetOutcomesFontSize);
    }

    if (exec.Requirements_Link) {
      s2.replaceAllText('{{Requirements_Link}}', exec.Requirements_Link);
    }
  }

  // ==========================================
  // SLIDE 3: What, How, and Why (Continuous Columns)
  // ==========================================
  const s3 = findSlideByPlaceholder(deck, '{{FlightPlan_What}}') || slides[2];
  if (payload.Slide3_FlightPlan && s3) {
    injectColumnMarkdownText(s3, '{{FlightPlan_What}}', payload.Slide3_FlightPlan.What || '');
    injectColumnMarkdownText(s3, '{{FlightPlan_How}}', payload.Slide3_FlightPlan.How || '');
    injectColumnMarkdownText(s3, '{{PlightPlan_How}}', payload.Slide3_FlightPlan.How || '');
    injectColumnMarkdownText(s3, '{{FlightPlan_Why}}', payload.Slide3_FlightPlan.Why || '');
  }

  // ==========================================
  // SLIDE 4: Strategic Alignment (Focus Areas & 4-8-4 Pure Narrative)
  // ==========================================
  const s4 = findSlideByPlaceholder(deck, '{{Strategic_Alignment_Explanat}}') 
          || findSlideByPlaceholder(deck, '{{Strategic_Alignment_Explanation}}') 
          || findSlideByPlaceholder(deck, '{{Alignment_Narrative}}')
          || slides[3];

  if (payload.Slide4_StrategicAlignment && s4) {
    const s4Data = payload.Slide4_StrategicAlignment;
    let narrative = (s4Data.Alignment_Narrative || s4Data.Explanation || '').trim();

    narrative = narrative
      .replace(/^\s*\*\*?Enterprise Priority:\*\*?[^\n]*\n?/im, '')
      .replace(/^\s*\*\*?Capability Pillar:\*\*?[^\n]*\n?/im, '')
      .replace(/^\s*\*\*?Foundational Enabler:\*\*?[^\n]*\n?/im, '')
      .trim();

    injectScaledMarkdownText(s4, '{{Strategic_Alignment_Explanat}}', narrative);
    injectScaledMarkdownText(s4, '{{Strategic_Alignment_Explanation}}', narrative);
    injectScaledMarkdownText(s4, '{{Alignment_Narrative}}', narrative);

    injectScaledMarkdownText(s4, '{{Enterprise_Priority}}', s4Data.Enterprise_Priority || '');
    injectScaledMarkdownText(s4, '{{Capability_Pillar}}', s4Data.Capability_Pillar || '');
    injectScaledMarkdownText(s4, '{{Foundational_Enabler}}', s4Data.Foundational_Enabler || '');
  }

  // ==========================================
  // SLIDE 5: Capabilities & Technologies (6 rows/slide with full pagination)
  // ==========================================
  const s5Index = deck.getSlides().findIndex(s =>
    s.getShapes().some(sh => {
      try { 
        const txt = sh.getText().asString();
        return txt.includes('Capabilities, Technologies, Status') || txt.includes('Capabilities, Technologies');
      } catch (e) { return false; }
    }) ||
    s.getTables().some(t => {
      try {
        const header = t.getRow(0).getCell(0).getText().asString();
        return header.includes('Capability') || header.includes('Level 3');
      } catch (e) { return false; }
    })
  );

  if (payload.Slide5_TechInventory && Array.isArray(payload.Slide5_TechInventory) && s5Index !== -1) {
    const originalSlide5 = deck.getSlides()[s5Index];
    const inventory = payload.Slide5_TechInventory;
    const ROWS_PER_SLIDE = 6;
    const totalChunks = Math.max(1, Math.ceil(inventory.length / ROWS_PER_SLIDE));

    for (let c = totalChunks - 1; c >= 0; c--) {
      const activeSlide = originalSlide5.duplicate();
      activeSlide.move(s5Index + 1);

      if (totalChunks > 1 && c > 0) {
        activeSlide.getShapes().forEach(sh => {
          try {
            const txt = sh.getText().asString();
            if (txt.includes('Capabilities, Technologies, Status') || txt.includes('Capabilities, Technologies')) {
              sh.getText().setText(txt.trim() + ` (Cont. Page ${c + 1} of ${totalChunks})`);
            }
          } catch(e) {}
        });
      }

      const chunk = inventory.slice(c * ROWS_PER_SLIDE, (c + 1) * ROWS_PER_SLIDE);
      const tables = activeSlide.getTables();

      if (tables.length > 0) {
        const table = tables[0];
        while (table.getNumRows() > 1) {
          try {
            table.getRow(table.getNumRows() - 1).remove();
          } catch (e) {
            break;
          }
        }

        chunk.forEach(item => {
          try {
            const row = table.appendRow();
            const rawTech = item.Technology || '';
            const rawJust = item.Justification || item.Comments || '';
            
            const parsedTech = parseMarkdown(rawTech);
            const parsedJust = parseMarkdown(rawJust);

            const rowData = [
              item.Capability || '', 
              parsedTech.cleanText, 
              item.Governance || 'Approved for Enterprise Use',
              item.TIME || 'Invest', 
              item.Lifecycle || item.Status || 'Adding', 
              parsedJust.cleanText
            ];

            for (let col = 0; col < Math.min(6, row.getNumCells()); col++) {
              try {
                const cell = row.getCell(col);
                if (cell.getMergeState() !== SlidesApp.CellMergeState.MERGED) {
                  const cellText = cell.getText();
                  cellText.setText(rowData[col]);
                  try { cell.getFill().setTransparent(); } catch (e) {}

                  const isBoldCol = (col === 1);
                  cellText.getTextStyle().setFontSize(7.5).setBold(isBoldCol).setForegroundColor(isBoldCol ? '#0F2942' : '#333333');
                  
                  cellText.getParagraphs().forEach(p => {
                    try {
                      p.getRange().getParagraphStyle().setLineSpacing(110).setSpaceAbove(0).setSpaceBelow(0);
                    } catch (e) {}
                  });

                  if (col === 5 && parsedJust.boldRanges && parsedJust.boldRanges.length > 0) {
                    parsedJust.boldRanges.forEach(b => {
                      try {
                        cellText.getRange(b.start, b.end).getTextStyle().setBold(true).setForegroundColor('#0F2942');
                      } catch (e) {}
                    });
                  }
                }
              } catch (e) {}
            }
          } catch (e) {}
        });
      }
    }
    originalSlide5.remove();
  }

  // ==========================================
  // SLIDES 6-11: Architecture Narratives
  // ==========================================
  const s6 = findSlideByPlaceholder(deck, '{{System_Context}}');
  if (s6 && payload.Slide6_Context) injectAdaptiveMarkdownText(s6, '{{System_Context}}', payload.Slide6_Context.Narrative || '');

  const s7 = findSlideByPlaceholder(deck, '{{Current_State}}');
  if (s7 && payload.Slide7_Current) injectAdaptiveMarkdownText(s7, '{{Current_State}}', payload.Slide7_Current.Narrative || '');

  const s8 = findSlideByPlaceholder(deck, '{{Interim State}}') || findSlideByPlaceholder(deck, '{{Interim_State}}');
  if (s8 && payload.Slide8_Interim) {
    injectAdaptiveMarkdownText(s8, '{{Interim State}}', payload.Slide8_Interim.Narrative || '');
    injectAdaptiveMarkdownText(s8, '{{Interim_State}}', payload.Slide8_Interim.Narrative || '');
  }

  const s9 = findSlideByPlaceholder(deck, '{{Target_State}}');
  if (s9 && payload.Slide9_Target) injectAdaptiveMarkdownText(s9, '{{Target_State}}', payload.Slide9_Target.Narrative || '');

  const s10 = findSlideByPlaceholder(deck, '{{System_Deployment}}');
  if (s10 && payload.Slide10_Deployment) injectAdaptiveMarkdownText(s10, '{{System_Deployment}}', payload.Slide10_Deployment.Narrative || '');

  const s11 = findSlideByPlaceholder(deck, '{{Information_Flow}}');
  if (s11 && payload.Slide11_InfoFlow) {
    const s11Content = payload.Slide11_InfoFlow.Narrative || 
      (Array.isArray(payload.Slide11_InfoFlow.Steps) ? payload.Slide11_InfoFlow.Steps.join('\n\n') : '') || '';
    injectAdaptiveMarkdownText(s11, '{{Information_Flow}}', s11Content);
  }

  // ==========================================
  // SLIDE 12: Appendix Structured Cards (Full Duplication & Clean Replacement)
  // ==========================================
  let s12Index = deck.getSlides().findIndex(s =>
    s.getShapes().some(sh => {
      try {
        const txt = sh.getText().asString();
        return txt.includes('Appendix') || txt.includes('{{Card_1_Title}}') || txt.includes('{{Appendix_Title}}');
      } catch (e) {
        return false;
      }
    }) ||
    s.getTables().some(t => {
      try {
        return t.getCell(0, 0).getText().asString().includes('{{Card_');
      } catch (e) { return false; }
    })
  );

  if (s12Index === -1) {
    const s13Candidate = deck.getSlides().findIndex(s =>
      s.getShapes().some(sh => {
        try {
          const txt = sh.getText().asString();
          return txt.includes('Referenced Standards') || txt.includes('{{ID_1}}');
        } catch (e) { return false; }
      }) ||
      s.getTables().some(t => {
        try {
          return t.getCell(0, 0).getText().asString().includes('{{ID_1}}');
        } catch (e) { return false; }
      })
    );
    if (s13Candidate > 0) {
      s12Index = s13Candidate - 1;
    } else {
      s12Index = Math.max(0, deck.getSlides().length - 2);
    }
  }

  if (payload.Slide12_Appendix_Artifacts && Array.isArray(payload.Slide12_Appendix_Artifacts) && s12Index !== -1) {
    const originalSlide12 = deck.getSlides()[s12Index];
    const artifacts = payload.Slide12_Appendix_Artifacts;
    const CARDS_PER_SLIDE = 3;
    const totalChunks = Math.max(1, Math.ceil(artifacts.length / CARDS_PER_SLIDE));
    const baseTitle = payload.Slide12_Title || 'Data Governance, Integration Patterns & Technical Appendix';

    for (let c = totalChunks - 1; c >= 0; c--) {
      const cardSlide = originalSlide12.duplicate();
      cardSlide.move(s12Index + 1);

      try {
        cardSlide.getBackground().setSolidFill('#FFFFFF');
      } catch (e) {}

      const slideTitle = (totalChunks > 1 && c > 0) ? `${baseTitle} (Cont. Page ${c + 1} of ${totalChunks})` : baseTitle;

      let titleSet = false;
      cardSlide.getShapes().forEach(s => {
        try {
          const txt = s.getText().asString().trim();
          if (txt === 'Appendix' || txt.includes('Reference Artifacts') || txt.includes('{{Appendix_Title}}') || txt.includes('Data Governance')) {
            s.getText().setText(slideTitle);
            s.getText().getTextStyle().setFontSize(16).setBold(true).setForegroundColor('#0F2942');
            titleSet = true;
          } else if (!txt.includes('COSTCO') && !txt.includes('Template')) {
            s.remove();
          }
        } catch(e) {}
      });

      if (!titleSet) {
        const titleShape = cardSlide.insertShape(SlidesApp.ShapeType.RECTANGLE, 28, 24, 664, 36);
        titleShape.getText().setText(slideTitle);
        titleShape.getText().getTextStyle().setFontSize(16).setBold(true).setForegroundColor('#0F2942');
      }

      const chunk = artifacts.slice(c * CARDS_PER_SLIDE, (c + 1) * CARDS_PER_SLIDE);
      renderCalibratedAppendixCards(cardSlide, chunk);
    }
    originalSlide12.remove();
  }

  // ==========================================
  // SLIDE 13: Governance, Decisions & Standards (Full Duplication & Resilient Parsing)
  // ==========================================
  const s13Index = deck.getSlides().findIndex(s =>
    s.getShapes().some(sh => {
      try {
        const txt = sh.getText().asString();
        return txt.includes('Referenced Standards') || txt.includes('{{ID_1}}');
      } catch (e) {
        return false;
      }
    }) ||
    s.getTables().some(t => {
      for (let r = 0; r < t.getNumRows(); r++) {
        for (let c = 0; c < t.getRow(r).getNumCells(); c++) {
          try {
            const txt = t.getCell(r, c).getText().asString();
            if (txt.includes('Referenced Standards') || txt.includes('{{ID_1}}')) return true;
          } catch(e) {}
        }
      }
      return false;
    })
  );

  if (payload.Slide13_Governance_and_NFRs && Array.isArray(payload.Slide13_Governance_and_NFRs) && s13Index !== -1) {
    const originalSlide13 = deck.getSlides()[s13Index];
    const items = payload.Slide13_Governance_and_NFRs;
    const ITEMS_PER_SLIDE = 6;
    const totalChunks = Math.max(1, Math.ceil(items.length / ITEMS_PER_SLIDE));

    for (let c = totalChunks - 1; c >= 0; c--) {
      const activeSlide = originalSlide13.duplicate();
      activeSlide.move(s13Index + 1);

      if (totalChunks > 1 && c > 0) {
        activeSlide.getShapes().forEach(sh => {
          try {
            const txt = sh.getText().asString();
            if (txt.includes('Referenced Standards') || txt.includes('Governance')) {
              sh.getText().setText(txt.trim() + ` (Cont. Page ${c + 1} of ${totalChunks})`);
            }
          } catch(e) {}
        });
      }

      const chunk = items.slice(c * ITEMS_PER_SLIDE, (c + 1) * ITEMS_PER_SLIDE);

      for (let i = 1; i <= 6; i++) {
        const item = chunk[i - 1];
        if (item) {
          activeSlide.replaceAllText(`{{ID_${i}}}`, item.ID || '');
          activeSlide.replaceAllText(`{{Category_${i}}}`, item.Category || '');
          activeSlide.replaceAllText(`{{Cat_${i}}}`, item.Category || '');
          activeSlide.replaceAllText(`{{Title_${i}}}`, item.Title || '');
          
          const parsedDetails = parseMarkdown(item.Details || '');
          activeSlide.replaceAllText(`{{Details_${i}}}`, parsedDetails.cleanText);

          let categoryColor = '#0F2942';
          if (item.Category === 'Standard') categoryColor = '#047857';
          if (item.Category === 'Exception') categoryColor = '#B91C1C';
          if (item.Category === 'NFR') categoryColor = '#1D4ED8';
          if (item.Category === 'KAD' || item.Category === 'KDD') categoryColor = '#6B21A8';

          const applyItemStyles = (textRange) => {
            const str = textRange.asString();
            if (item.ID && str.includes(item.ID)) {
              const idIndex = str.indexOf(item.ID);
              if (idIndex > -1) {
                textRange.getRange(idIndex, idIndex + item.ID.length)
                  .getTextStyle().setBold(true).setForegroundColor(categoryColor);
              }
            }
            if (parsedDetails.cleanText && str.includes(parsedDetails.cleanText)) {
              const dIndex = str.indexOf(parsedDetails.cleanText);
              if (dIndex > -1) {
                parsedDetails.boldRanges.forEach(b => {
                  try {
                    textRange.getRange(dIndex + b.start, dIndex + b.end)
                      .getTextStyle().setBold(true).setForegroundColor('#0F2942');
                  } catch (e) {}
                });
              }
            }
          };

          activeSlide.getShapes().forEach(shape => { try { applyItemStyles(shape.getText()); } catch(e) {} });
          activeSlide.getTables().forEach(table => {
            for (let r = 0; r < table.getNumRows(); r++) {
              for (let col = 0; col < table.getRow(r).getNumCells(); col++) {
                try {
                  const cell = table.getCell(r, col);
                  if (cell.getMergeState() !== SlidesApp.CellMergeState.MERGED) {
                    applyItemStyles(cell.getText());
                  }
                } catch(e) {}
              }
            }
          });

        } else {
          activeSlide.replaceAllText(`{{ID_${i}}}`, '');
          activeSlide.replaceAllText(`{{Category_${i}}}`, '');
          activeSlide.replaceAllText(`{{Cat_${i}}}`, '');
          activeSlide.replaceAllText(`{{Title_${i}}}`, '');
          activeSlide.replaceAllText(`{{Details_${i}}}`, '');
        }
      }
    }
    originalSlide13.remove();
  }

  deck.saveAndClose();
  return newDeckFile.getUrl();
}

// ==========================================
// FORMATTING & NORMALIZATION HELPERS
// ==========================================

function normalizeSlide2Section(rawText, headerName) {
  if (!rawText) return '';
  let text = rawText.trim();
  // Remove existing headers if the AI included them
  const headerRegex = new RegExp(`^(\\*\\*)?${headerName}:?(\\*\\*)?\\s*`, 'i');
  text = text.replace(headerRegex, '').trim();
  
  // Clean up bullet line breaks
  text = text.replace(/\n\s*\n\s*(•|\*|-)/g, '\n$1');
  
  // SPACING FIX: Exactly 1 newline after the header
  return `${headerName}:\n${text}`;
}

function injectSlide2ExecutiveSummary(slide, placeholder, rawText, explicitFontSize) {
  if (!slide || !rawText) return;
  const parsed = parseMarkdown(rawText.trim());
  slide.replaceAllText(placeholder, parsed.cleanText);

  const applyFormatting = (textObj) => {
    const str = textObj.asString();
    const cleanIndex = str.indexOf(parsed.cleanText);
    if (cleanIndex !== -1) {
      const baseSize = (explicitFontSize !== undefined && explicitFontSize !== null)
        ? explicitFontSize
        : getTailoredFontSize(parsed.cleanText.length, 7.5, 8.5);

      const range = textObj.getRange(cleanIndex, cleanIndex + parsed.cleanText.length);
      range.getTextStyle().setFontSize(baseSize).setBold(false).setForegroundColor('#333333');

      textObj.getParagraphs().forEach(p => {
        try {
          const pStyle = p.getRange().getParagraphStyle();
          pStyle.setLineSpacing(105);
          pStyle.setSpaceAbove(0);
          pStyle.setSpaceBelow(1);
        } catch (e) {}
      });

      parsed.boldRanges.forEach(b => {
        try {
          textObj.getRange(cleanIndex + b.start, cleanIndex + b.end)
            .getTextStyle().setBold(true).setForegroundColor('#0F2942');
        } catch (e) {}
      });

      const headers = ['Problem Statement:', 'Problem Statement', 'Target Outcomes:', 'Target Outcomes'];
      headers.forEach(h => {
        let idx = 0;
        while ((idx = str.indexOf(h, idx)) !== -1) {
          try {
            textObj.getRange(idx, idx + h.length)
              .getTextStyle().setFontSize(baseSize + 1.0).setBold(true).setForegroundColor('#0F2942');
          } catch (e) {}
          idx += h.length;
        }
      });
    }
  };

  slide.getShapes().forEach(shape => { try { applyFormatting(shape.getText()); } catch (e) {} });
  slide.getTables().forEach(table => {
    for (let r = 0; r < table.getNumRows(); r++) {
      for (let c = 0; c < table.getRow(r).getNumCells(); c++) {
        try {
          const cell = table.getCell(r, c);
          if (cell.getMergeState() !== SlidesApp.CellMergeState.MERGED) {
            applyFormatting(cell.getText());
          }
        } catch (e) {}
      }
    }
  });
}

function findSlideByPlaceholder(deck, placeholder) {
  const slides = deck.getSlides();
  for (let s = 0; s < slides.length; s++) {
    const slide = slides[s];
    const shapes = slide.getShapes();
    for (let i = 0; i < shapes.length; i++) {
      try {
        if (shapes[i].getText().asString().includes(placeholder)) return slide;
      } catch (e) {}
    }
    const tables = slide.getTables();
    for (let t = 0; t < tables.length; t++) {
      const table = tables[t];
      for (let r = 0; r < table.getNumRows(); r++) {
        for (let c = 0; c < table.getRow(r).getNumCells(); c++) {
          try {
            const cell = table.getCell(r, c);
            if (cell.getMergeState() !== SlidesApp.CellMergeState.MERGED) {
              if (cell.getText().asString().includes(placeholder)) return slide;
            }
          } catch (e) {}
        }
      }
    }
  }
  return null;
}

function parseMarkdown(rawText) {
  let cleanText = "";
  const boldRanges = [];
  const regex = /\*\*(.*?)\*\*/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(rawText)) !== null) {
    cleanText += rawText.substring(lastIdx, match.index);
    const start = cleanText.length;
    cleanText += match[1];
    const end = cleanText.length;
    boldRanges.push({ start: start, end: end });
    lastIdx = regex.lastIndex;
  }
  cleanText += rawText.substring(lastIdx);
  return { cleanText: cleanText, boldRanges: boldRanges };
}

function getTailoredFontSize(textLength, minSize = 7.5, maxSize = 10.0) {
  if (textLength <= 250) return maxSize;
  if (textLength >= 1200) return minSize;
  const scaleFactor = (textLength - 250) / (1200 - 250);
  const calculatedSize = maxSize - scaleFactor * (maxSize - minSize);
  return Math.round(calculatedSize * 10) / 10;
}

function injectColumnMarkdownText(slide, placeholder, rawText) {
  if (!slide || !rawText) return;
  const parsed = parseMarkdown(rawText.trim());
  slide.replaceAllText(placeholder, parsed.cleanText);

  const applyFormatting = (textObj) => {
    const str = textObj.asString();
    const cleanIndex = str.indexOf(parsed.cleanText);
    if (cleanIndex !== -1) {
      const optimalSize = getTailoredFontSize(parsed.cleanText.length, 7.8, 8.8);
      const range = textObj.getRange(cleanIndex, cleanIndex + parsed.cleanText.length);
      range.getTextStyle().setFontSize(optimalSize).setBold(false).setForegroundColor('#333333');

      textObj.getParagraphs().forEach(p => {
        try {
          const pStyle = p.getRange().getParagraphStyle();
          pStyle.setLineSpacing(108);
          pStyle.setSpaceAbove(0);
          pStyle.setSpaceBelow(3);
        } catch (e) {}
      });

      parsed.boldRanges.forEach(b => {
        try {
          textObj.getRange(cleanIndex + b.start, cleanIndex + b.end)
            .getTextStyle().setBold(true).setForegroundColor('#0F2942');
        } catch (e) {}
      });
    }
  };

  slide.getShapes().forEach(shape => { try { applyFormatting(shape.getText()); } catch (e) {} });
  slide.getTables().forEach(table => {
    for (let r = 0; r < table.getNumRows(); r++) {
      for (let c = 0; c < table.getRow(r).getNumCells(); c++) {
        try {
          const cell = table.getCell(r, c);
          if (cell.getMergeState() !== SlidesApp.CellMergeState.MERGED) {
            applyFormatting(cell.getText());
          }
        } catch (e) {}
      }
    }
  });
}

function injectAdaptiveMarkdownText(slide, placeholder, rawText) {
  if (!slide || !rawText) return;
  const parsed = parseMarkdown(rawText.trim());
  slide.replaceAllText(placeholder, parsed.cleanText);

  const applyFormatting = (textObj) => {
    const str = textObj.asString();
    const cleanIndex = str.indexOf(parsed.cleanText);
    if (cleanIndex !== -1) {
      const optimalSize = getTailoredFontSize(parsed.cleanText.length, 7.8, 8.8);
      const range = textObj.getRange(cleanIndex, cleanIndex + parsed.cleanText.length);
      range.getTextStyle().setFontSize(optimalSize).setBold(false).setForegroundColor('#333333');

      textObj.getParagraphs().forEach(p => {
        try {
          const pStyle = p.getRange().getParagraphStyle();
          pStyle.setLineSpacing(108);
          pStyle.setSpaceAbove(0);
          pStyle.setSpaceBelow(2);
        } catch (e) {}
      });

      parsed.boldRanges.forEach(b => {
        try {
          textObj.getRange(cleanIndex + b.start, cleanIndex + b.end)
            .getTextStyle().setBold(true).setForegroundColor('#0F2942');
        } catch (e) {}
      });
    }
  };

  slide.getShapes().forEach(shape => { try { applyFormatting(shape.getText()); } catch (e) {} });
  slide.getTables().forEach(table => {
    for (let r = 0; r < table.getNumRows(); r++) {
      for (let c = 0; c < table.getRow(r).getNumCells(); c++) {
        try {
          const cell = table.getCell(r, c);
          if (cell.getMergeState() !== SlidesApp.CellMergeState.MERGED) {
            applyFormatting(cell.getText());
          }
        } catch (e) {}
      }
    }
  });
}

function injectScaledMarkdownText(slide, placeholder, rawText) {
  if (!slide || !rawText) return;
  const parsed = parseMarkdown(rawText.trim());
  slide.replaceAllText(placeholder, parsed.cleanText);

  slide.getShapes().forEach(shape => {
    try {
      const textObj = shape.getText();
      const str = textObj.asString();
      const cleanIndex = str.indexOf(parsed.cleanText);

      if (cleanIndex !== -1) {
        const optimalSize = getTailoredFontSize(parsed.cleanText.length, 6.8, 8.2);
        const range = textObj.getRange(cleanIndex, cleanIndex + parsed.cleanText.length);
        range.getTextStyle().setFontSize(optimalSize).setBold(false).setForegroundColor('#333333');

        textObj.getParagraphs().forEach(p => {
          try {
            p.getRange().getParagraphStyle().setLineSpacing(108);
            p.getRange().getParagraphStyle().setSpaceAbove(0);
            p.getRange().getParagraphStyle().setSpaceBelow(2);
          } catch (e) {}
        });

        parsed.boldRanges.forEach(b => {
          try {
            textObj.getRange(cleanIndex + b.start, cleanIndex + b.end)
              .getTextStyle().setBold(true).setForegroundColor('#0F2942');
          } catch (e) {}
        });
      }
    } catch (e) {}
  });
}

function renderCalibratedAppendixCards(slide, cardDataList) {
  slide.getShapes().forEach(s => {
    try {
      const txt = s.getText().asString();
      if (txt.includes('{{Card_')) s.remove();
    } catch(e) {}
  });

  slide.getTables().forEach(t => {
    try { t.remove(); } catch(e) {}
  });

  const marginX = 28;
  const marginTop = 70;
  const cardWidth = 208;
  const cardSpacing = 20;
  const headerHeight = 24;

  cardDataList.forEach((card, i) => {
    const left = marginX + i * (cardWidth + cardSpacing);

    const headerShape = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, left, marginTop, cardWidth, headerHeight);
    headerShape.getFill().setSolidFill('#00457C');
    headerShape.getBorder().setTransparent();
    headerShape.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);

    const hText = headerShape.getText();
    hText.setText(card.Title || '');
    hText.getTextStyle().setFontSize(8.8).setBold(true).setForegroundColor('#FFFFFF');
    hText.getParagraphs().forEach(p => {
      try {
        p.getRange().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
      } catch (e) {}
    });

    let rowsData = [];
    if (card.Rows && Array.isArray(card.Rows) && card.Rows.length > 0) {
      rowsData = card.Rows.map(r => ({
        Label: r.Label || r.label || r.Parameter || r["Parameter / Dimension"] || '',
        Value: r.Value || r.value || r.Specification || r["Architectural Specification & Policy Detail"] || ''
      }));
    } else if (card.Description) {
      const lines = card.Description.split('\n').filter(l => l.trim().length > 0);
      lines.forEach(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          rowsData.push({ 
            Label: line.substring(0, colonIdx).replace(/\*/g, '').replace(/•/g, '').trim(), 
            Value: line.substring(colonIdx + 1).trim() 
          });
        }
      });
    }

    if (rowsData.length === 0) return;

    // Adjusted Table Heights, Padding, and Column Widths for better spacing
    const numRows = Math.min(4, rowsData.length);
    const initialTableHeight = Math.min(180, numRows * 32); 
    const tableTop = marginTop + headerHeight + 4; 
    const table = slide.insertTable(numRows, 2, left, tableTop, cardWidth, initialTableHeight);

    try {
      table.getColumn(0).setWidth(75); 
      table.getColumn(1).setWidth(133);
    } catch(e) {}

    for (let rIdx = 0; rIdx < numRows; rIdx++) {
      const rowItem = rowsData[rIdx];
      try {
        const cellLabel = table.getCell(rIdx, 0);
        cellLabel.getFill().setSolidFill('#EDF3F8');
        cellLabel.setContentAlignment(SlidesApp.ContentAlignment.TOP);

        const labelText = cellLabel.getText();
        labelText.setText(rowItem.Label || '');
        labelText.getTextStyle().setFontSize(7.0).setBold(true).setForegroundColor('#00457C');

        const cellVal = table.getCell(rIdx, 1);
        cellVal.getFill().setSolidFill('#FFFFFF');
        cellVal.setContentAlignment(SlidesApp.ContentAlignment.TOP);

        const parsed = parseMarkdown(rowItem.Value || '');
        const valText = cellVal.getText();
        valText.setText(parsed.cleanText);
        valText.getTextStyle().setFontSize(7.0).setBold(false).setForegroundColor('#333333');

        // Increase line spacing slightly for readability
        valText.getParagraphs().forEach(p => {
          try {
            const pStyle = p.getRange().getParagraphStyle();
            pStyle.setLineSpacing(110);
            pStyle.setSpaceAbove(2);
            pStyle.setSpaceBelow(2);
          } catch(e) {}
        });

        parsed.boldRanges.forEach(b => {
          try {
            valText.getRange(b.start, b.end).getTextStyle().setBold(true).setForegroundColor('#0F2942');
          } catch(e) {}
        });
      } catch(e) {}
    }
  });
}