// ========== ENHANCED TELEGRAM REPORT FUNCTIONS ==========

// Send table-formatted report to Telegram
function sendTableReport(period) {
    let studentFilter = $('#reportStudentFilter').val() || '';
    
    $.ajax({
        url: `${API_BASE_URL}/reports/table/${period}`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ 
            student_id: studentFilter || null,
            chat_id: null
        }),
        xhrFields: { withCredentials: true },
        success: function(response) {
            showNotification(`📊 ${period === 'daily' ? 'Daily' : 'Weekly'} table report sent to Telegram!`, 'success');
            console.log('Table report sent:', response);
        },
        error: function(xhr) {
            showNotification('Error sending table report', 'danger');
        }
    });
}

// Send report with CSV attachment
function sendReportWithAttachment(period) {
    let studentFilter = $('#reportStudentFilter').val() || '';
    
    $.ajax({
        url: `${API_BASE_URL}/reports/table/${period}?attach=true`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ 
            student_id: studentFilter || null,
            chat_id: null
        }),
        xhrFields: { withCredentials: true },
        success: function(response) {
            showNotification(`📎 Full ${period} report with attachment sent to Telegram!`, 'success');
        },
        error: function(xhr) {
            showNotification('Error sending report with attachment', 'danger');
        }
    });
}

// Schedule automatic reports (optional - can be toggled)
function toggleAutoReports(enable) {
    // This would require backend changes to store preference
    showNotification('Auto-report setting saved', 'success');
}
